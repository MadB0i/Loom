use std::net::{SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use socket2::{Domain, Protocol, Socket, Type};
use tauri::{AppHandle, Emitter, Manager};

use crate::lan_sync::{self, LanState};

// PHASE 10: real-identity LAN discovery. Announces the user's Loom ID + display name
// + TCP sync port over UDP broadcast; tracks peer liveness with a silence timeout and
// notifies the frontend via `lan-peer` / `lan-peer-lost` events.

const DISCOVERY_PORT: u16 = 50897;
const BROADCAST_TARGET: &str = "255.255.255.255:50897";
const ANNOUNCE_INTERVAL: Duration = Duration::from_secs(3);
const PEER_TIMEOUT: Duration = Duration::from_secs(10);
const PACKET_PREFIX: &str = "LOOM_DISCOVERY_V2";

#[derive(Serialize, Clone)]
#[allow(non_snake_case)]
struct PeerLost<'a> {
    loomId: &'a str,
}

pub fn start(app: AppHandle) {
    let socket = match make_socket() {
        Ok(s) => Arc::new(s),
        Err(err) => {
            eprintln!(
                "[discovery] FATAL: could not bind UDP :{DISCOVERY_PORT} — {err}. \
                 Another instance may hold the port without SO_REUSEADDR."
            );
            return;
        }
    };
    println!(
        "[discovery] announcing on UDP :{DISCOVERY_PORT} every {}s; peers expire after {}s of silence",
        ANNOUNCE_INTERVAL.as_secs(),
        PEER_TIMEOUT.as_secs()
    );

    start_announcer(app.clone(), Arc::clone(&socket));
    start_listener(app.clone(), socket);
    start_sweeper(app);
}

fn make_socket() -> std::io::Result<UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    // Two instances on one machine must coexist on the same port; broadcast
    // datagrams are delivered to every socket bound to the port.
    socket.set_reuse_address(true)?;
    socket.bind(&SocketAddr::from(([0, 0, 0, 0], DISCOVERY_PORT)).into())?;
    let udp: UdpSocket = socket.into();
    udp.set_broadcast(true)?;
    udp.set_read_timeout(Some(Duration::from_millis(500)))?;
    Ok(udp)
}

fn start_announcer(app: AppHandle, socket: Arc<UdpSocket>) {
    std::thread::spawn(move || loop {
        let (identity, tcp_port) = {
            let state = app.state::<LanState>();
            match (state.identity(), state.own_tcp_port()) {
                (Some(id), port) => (id, port),
                (None, _) => {
                    // Identity not pushed yet — wait for set_discovery_identity.
                    std::thread::sleep(ANNOUNCE_INTERVAL);
                    continue;
                }
            }
        };
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let packet = format!(
            "{PACKET_PREFIX}|{}|{}|{tcp_port}|{ts}",
            identity.loom_id, identity.display_name
        );
        match socket.send_to(packet.as_bytes(), BROADCAST_TARGET) {
            Ok(n) => println!("[discovery] sent {n}B announce as {}", identity.loom_id),
            Err(err) => eprintln!("[discovery] send failed: {err}"),
        }
        std::thread::sleep(ANNOUNCE_INTERVAL);
    });
}

fn start_listener(app: AppHandle, socket: Arc<UdpSocket>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 512];
        loop {
            match socket.recv_from(&mut buf) {
                Ok((len, src)) => {
                    let text = String::from_utf8_lossy(&buf[..len]);
                    let Some((loom_id, display_name, tcp_port)) = parse_packet(&text) else {
                        continue;
                    };
                    let own = app.state::<LanState>().own_loom_id();
                    if own.as_deref() == Some(loom_id.as_str()) {
                        continue; // our own broadcast echoed back
                    }
                    lan_sync::on_announce(&app, loom_id, display_name, src.ip(), tcp_port);
                }
                Err(err)
                    if err.kind() == std::io::ErrorKind::WouldBlock
                        || err.kind() == std::io::ErrorKind::TimedOut =>
                {
                    // WouldBlock = read timeout tick; TimedOut = Windows delivering
                    // ICMP residue from broadcast sends (SIO_UDP_CONNRESET behaviour).
                    continue
                }
                Err(err) => eprintln!("[discovery] recv failed: {err}"),
            }
        }
    });
}

fn start_sweeper(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        let state = app.state::<LanState>();
        let expired = state.take_expired_peers(PEER_TIMEOUT);
        if expired.is_empty() {
            continue;
        }
        state.forget_peers(&expired);
        for id in &expired {
            let _ = app.emit("lan-peer-lost", PeerLost { loomId: id });
            println!("[discovery] peer expired after silence: {id}");
        }
    });
}

fn parse_packet(text: &str) -> Option<(String, String, u16)> {
    let mut parts = text.split('|');
    if parts.next()? != PACKET_PREFIX {
        return None;
    }
    let loom_id = parts.next()?.to_string();
    let display_name = parts.next()?.to_string();
    let tcp_port = parts.next()?.parse().ok()?;
    Some((loom_id, display_name, tcp_port))
}
