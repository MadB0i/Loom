mod lan_discovery;
mod lan_sync;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(lan_sync::LanState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      lan_sync::start(app.handle());
      lan_discovery::start(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      lan_sync::set_discovery_identity,
      lan_sync::update_contacts,
      lan_sync::lan_send
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
