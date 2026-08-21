use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

// PHASE 10: TCP-based LAN sync transport. Length-prefixed JSON frames relay Yjs
// update payloads between paired peers; Rust is a dumb relay, the frontend owns all
// Yjs semantics. Structurally extensible to N peers (one connection per peer), but
// group mesh is Phase 12 — only the 1-1 case is built/tested here.

pub const DEFAULT_TCP_PORT: u16 = 50898;
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
const RETRY_CONNECT_AFTER: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct IdentityInfo {
    pub loom_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub addr: IpAddr,
    pub tcp_port: u16,
    pub display_name: String,
    pub last_seen: Instant,
}

pub struct ConnectionHandle {
    writer: TcpStream,
    #[allow(dead_code)]
    generation: u64,
}

#[derive(Default)]
pub struct LanState {
    inner: Mutex<LanInner>,
}

#[derive(Default)]
struct LanInner {
    identity: Option<IdentityInfo>,
    contacts: HashSet<String>,
    peers: HashMap<String, PeerInfo>,
    connections: HashMap<String, Arc<ConnectionHandle>>,
    last_attempt: HashMap<String, Instant>,
    own_tcp_port: u16,
}

static GENERATION: AtomicU64 = AtomicU64::new(1);

impl LanState {
    pub fn identity(&self) -> Option<IdentityInfo> {
        self.inner.lock().ok()?.identity.clone()
    }

    pub fn own_tcp_port(&self) -> u16 {
        self.inner.lock().map(|g| g.own_tcp_port).unwrap_or(0)
    }

    fn set_identity(&self, info: IdentityInfo) {
        if let Ok(mut g) = self.inner.lock() {
            g.identity = Some(info);
        }
    }

    fn set_contacts(&self, ids: Vec<String>) {
        if let Ok(mut g) = self.inner.lock() {
            g.contacts = ids.into_iter().collect();
        }
    }

    pub(crate) fn own_loom_id(&self) -> Option<String> {
        self.identity().map(|i| i.loom_id)
    }

    pub(crate) fn is_trusted(&self, loom_id: &str) -> bool {
        self.inner.lock().map(|g| g.contacts.contains(loom_id)).unwrap_or(false)
    }

    // Returns (peer_is_new_or_renamed, should_connect_now).
    pub(crate) fn observe_announce(
        &self,
        loom_id: &str,
        display_name: &str,
        addr: IpAddr,
        tcp_port: u16,
    ) -> (bool, bool) {
        let Ok(mut g) = self.inner.lock() else { return (false, false) };
        let is_new = g
            .peers
            .get(loom_id)
            .map(|p| p.display_name != display_name)
            .unwrap_or(true);
        g.peers.insert(
            loom_id.to_string(),
            PeerInfo {
                addr,
                tcp_port,
                display_name: display_name.to_string(),
                last_seen: Instant::now(),
            },
        );
        let eligible = g.contacts.contains(loom_id)
            && g.identity.as_ref().map(|i| i.loom_id.as_str()) != Some(loom_id)
            && !g.connections.contains_key(loom_id)
            && g
                .last_attempt
                .get(loom_id)
                .map(|t| t.elapsed() > RETRY_CONNECT_AFTER)
                .unwrap_or(true);
        if eligible {
            g.last_attempt.insert(loom_id.to_string(), Instant::now());
        }
        (is_new, eligible)
    }

    pub(crate) fn take_expired_peers(&self, timeout: Duration) -> Vec<String> {
        let Ok(g) = self.inner.lock() else { return Vec::new() };
        g.peers
            .iter()
            .filter(|(_, p)| p.last_seen.elapsed() > timeout)
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub(crate) fn forget_peers(&self, ids: &[String]) {
        let Ok(mut g) = self.inner.lock() else { return };
        for id in ids {
            g.peers.remove(id);
            g.last_attempt.remove(id);
        }
    }

    pub(crate) fn retry_targets(&self) -> Vec<(String, SocketAddr)> {
        let Ok(g) = self.inner.lock() else { return Vec::new() };
        g.peers
            .iter()
            .filter(|(id, _)| g.contacts.contains(*id))
            .filter(|(id, _)| !g.connections.contains_key(*id))
            .filter(|(id, _)| {
                g.last_attempt
                    .get(*id)
                    .map(|t| t.elapsed() > RETRY_CONNECT_AFTER)
                    .unwrap_or(true)
            })
            .map(|(id, p)| (id.clone(), SocketAddr::new(p.addr, p.tcp_port)))
            .collect()
    }

    pub(crate) fn mark_attempt(&self, loom_id: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.last_attempt.insert(loom_id.to_string(), Instant::now());
        }
    }

    // Registers a live connection; shuts down and returns any duplicate it replaces.
    pub(crate) fn register(
        &self,
        loom_id: &str,
        handle: Arc<ConnectionHandle>,
    ) -> Option<Arc<ConnectionHandle>> {
        let mut g = self.inner.lock().ok()?;
        g.connections.insert(loom_id.to_string(), handle)
    }

    // Removes the connection only if `handle` is still the live one (generation guard).
    pub(crate) fn unregister_if_current(&self, loom_id: &str, handle: &Arc<ConnectionHandle>) -> bool {
        let Ok(mut g) = self.inner.lock() else { return false };
        let is_current = g
            .connections
            .get(loom_id)
            .map(|c| Arc::ptr_eq(c, handle))
            .unwrap_or(false);
        if is_current {
            g.connections.remove(loom_id);
        }
        is_current
    }

    pub(crate) fn connection_writer(&self, loom_id: &str) -> Option<TcpStream> {
        let g = self.inner.lock().ok()?;
        g.connections.get(loom_id)?.writer.try_clone().ok()
    }
}

#[derive(Serialize, Deserialize)]
struct HelloFrame<'a> {
    hello: &'a str,
}

#[derive(Serialize, Clone)]
#[allow(non_snake_case)]
struct DataEvent<'a> {
    loomId: &'a str,
    payload: &'a str,
}

#[derive(Serialize, Clone)]
#[allow(non_snake_case)]
struct PeerEvent<'a> {
    loomId: &'a str,
}

#[derive(Serialize, Clone)]
#[allow(non_snake_case)]
struct PeerEventPayload<'a> {
    loomId: &'a str,
    displayName: &'a str,
}

pub fn start(app: &AppHandle) {
    let listener = match make_listener() {
        Ok(l) => l,
        Err(err) => {
            eprintln!("[lan-sync] FATAL: TCP listener failed — {err}");
            return;
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    if let Ok(mut g) = app.state::<LanState>().inner.lock() {
        g.own_tcp_port = port;
    }
    println!("[lan-sync] listening on TCP :{port}");
    let handle = app.clone();
    std::thread::spawn(move || accept_loop(handle, listener));
}

fn make_listener() -> std::io::Result<TcpListener> {
    // Fixed port when free; a second instance on the same machine falls back to an
    // ephemeral port and advertises that instead.
    match TcpListener::bind(("0.0.0.0", DEFAULT_TCP_PORT)) {
        Ok(l) => Ok(l),
        Err(_) => TcpListener::bind(("0.0.0.0", 0)),
    }
}

// Called by lan_discovery whenever an announce arrives.
pub fn on_announce(
    app: &AppHandle,
    loom_id: String,
    display_name: String,
    addr: IpAddr,
    tcp_port: u16,
) {
    let state = app.state::<LanState>();
    let (is_new, should_connect) =
        state.observe_announce(&loom_id, &display_name, addr, tcp_port);
    if is_new {
        println!("[discovery] peer seen: {loom_id} ({display_name})");
        let _ = app.emit(
            "lan-peer",
            PeerEventPayload { loomId: &loom_id, displayName: &display_name },
        );
    }
    if should_connect {
        spawn_connect(app.clone(), loom_id, SocketAddr::new(addr, tcp_port));
    }
}

fn spawn_connect(app: AppHandle, loom_id: String, target: SocketAddr) {
    println!("[lan-sync] trusted peer announced — connecting to {loom_id} ({target})");
    std::thread::spawn(move || {
        if let Err(err) = connect_outbound(&app, &loom_id, target) {
            println!("[lan-sync] connect to {loom_id} failed: {err}");
        }
    });
}

// Called by the update_contacts command — retries any known contact peers.
pub fn retry_contacts(app: &AppHandle) {
    let state = app.state::<LanState>();
    for (loom_id, target) in state.retry_targets() {
        state.mark_attempt(&loom_id);
        spawn_connect(app.clone(), loom_id, target);
    }
}

fn connect_outbound(app: &AppHandle, loom_id: &str, target: SocketAddr) -> std::io::Result<()> {
    let own = app
        .state::<LanState>()
        .identity()
        .ok_or_else(|| std::io::Error::other("identity not ready"))?;
    let mut stream = TcpStream::connect_timeout(&target, CONNECT_TIMEOUT)?;
    stream.set_nodelay(true)?;
    let hello = HelloFrame { hello: &own.loom_id };
    write_frame(&mut stream, serde_json::to_vec(&hello)?.as_slice())?;
    register_connection(app, loom_id.to_string(), stream);
    Ok(())
}

fn accept_loop(app: AppHandle, listener: TcpListener) {
    loop {
        match listener.accept() {
            Ok((stream, src)) => {
                let handle = app.clone();
                std::thread::spawn(move || {
                    if let Err(err) = accept_inbound(handle, stream, src) {
                        println!("[lan-sync] inbound from {src} rejected: {err}");
                    }
                });
            }
            Err(err) => eprintln!("[lan-sync] accept failed: {err}"),
        }
    }
}

fn accept_inbound(app: AppHandle, mut stream: TcpStream, src: SocketAddr) -> std::io::Result<()> {
    stream.set_read_timeout(Some(HELLO_TIMEOUT))?;
    let frame =
        read_frame(&mut stream)?.ok_or_else(|| std::io::Error::other("closed before hello"))?;
    let hello: HelloFrame = serde_json::from_slice(&frame)?;
    let loom_id = hello.hello.to_string();
    stream.set_read_timeout(None)?;
    stream.set_nodelay(true)?;

    let state = app.state::<LanState>();
    if state.own_loom_id().as_deref() == Some(loom_id.as_str()) {
        return Err(std::io::Error::other("self-connection"));
    }
    if !state.is_trusted(&loom_id) {
        return Err(std::io::Error::other(format!("peer {loom_id} is not a trusted contact")));
    }
    println!("[lan-sync] inbound connection from {loom_id} ({src})");
    register_connection(&app, loom_id, stream);
    Ok(())
}

fn register_connection(app: &AppHandle, loom_id: String, stream: TcpStream) {
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
    let handle = Arc::new(ConnectionHandle {
        writer: stream.try_clone().expect("tcp clone"),
        generation,
    });

    if let Some(previous) =
        app.state::<LanState>().register(&loom_id, Arc::clone(&handle))
    {
        // Duplicate transport for the same peer: kill the old one so its reader
        // exits quietly instead of leaking a socket.
        let _ = previous.writer.shutdown(std::net::Shutdown::Both);
    }

    let _ = app.emit("lan-connected", PeerEvent { loomId: &loom_id });
    println!("[lan-sync] connected: {loom_id}");

    let reader_app = app.clone();
    let reader_handle = Arc::clone(&handle);
    let mut reader = stream;
    std::thread::spawn(move || {
        loop {
            match read_frame(&mut reader) {
                Ok(Some(frame)) => {
                    let payload = String::from_utf8_lossy(&frame).into_owned();
                    let _ =
                        reader_app.emit("lan-data", DataEvent { loomId: &loom_id, payload: &payload });
                }
                Ok(None) => break,
                Err(err) => {
                    println!("[lan-sync] read error from {loom_id}: {err}");
                    break;
                }
            }
        }
        if reader_app.state::<LanState>().unregister_if_current(&loom_id, &reader_handle) {
            let _ = reader_app.emit("lan-disconnected", PeerEvent { loomId: &loom_id });
            println!("[lan-sync] disconnected: {loom_id}");
        }
    });
}

fn read_frame(stream: &mut TcpStream) -> std::io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    if !read_exact_or_eof(stream, &mut len_buf)? {
        return Ok(None); // clean EOF between frames
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut frame = vec![0u8; len];
    if len > 0 && !read_exact_or_eof(stream, &mut frame)? {
        return Err(std::io::Error::other("EOF mid-frame"));
    }
    Ok(Some(frame))
}

// Like read_exact, but a clean EOF before the first byte yields Ok(false).
fn read_exact_or_eof(stream: &mut TcpStream, buf: &mut [u8]) -> std::io::Result<bool> {
    let mut filled = 0;
    while filled < buf.len() {
        match stream.read(&mut buf[filled..]) {
            Ok(0) => {
                if filled == 0 {
                    return Ok(false);
                }
                return Err(std::io::Error::other("EOF mid-frame"));
            }
            Ok(n) => filled += n,
            Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(true)
}

fn write_frame(stream: &mut TcpStream, data: &[u8]) -> std::io::Result<()> {
    let len = u32::try_from(data.len()).map_err(|_| std::io::Error::other("frame too large"))?;
    stream.write_all(&len.to_le_bytes())?;
    stream.write_all(data)?;
    stream.flush()
}

// Commands -----------------------------------------------------------------

#[tauri::command]
pub fn set_discovery_identity(
    state: tauri::State<LanState>,
    loom_id: String,
    display_name: String,
) {
    let sanitized = display_name.replace('|', " ").replace('\n', " ").trim().to_string();
    state.set_identity(IdentityInfo { loom_id, display_name: sanitized });
}

#[tauri::command]
pub fn update_contacts(state: tauri::State<LanState>, app: AppHandle, ids: Vec<String>) {
    state.set_contacts(ids);
    retry_contacts(&app);
}

#[tauri::command]
pub fn lan_send(state: tauri::State<LanState>, loom_id: String, payload: String) -> Result<(), String> {
    let mut writer = state
        .connection_writer(&loom_id)
        .ok_or_else(|| format!("no connection to {loom_id}"))?;
    write_frame(&mut writer, payload.as_bytes()).map_err(|e| format!("send failed: {e}"))
}
