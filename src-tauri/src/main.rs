mod commands;
mod git_info;
mod overlay;
mod runtime;
mod session_scan;

use commands::*;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let state = load_state(&app.handle());
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            locate_omp,
            set_omp_path,
            get_health,
            get_overlay,
            get_models,
            refresh_models,
            list_projects,
            add_project,
            remove_project,
            relocate_project,
            list_sessions,
            create_session,
            open_session,
            archive_session,
            unarchive_session,
            delete_session,
            archive_sessions,
            delete_sessions,
            rename_session_note,
            get_history,
            send_message,
            read_image_file,
            stop_session,
            approve,
            respond_ui,
            set_model,
            set_thinking,
            get_session_runtime,
            get_global_approval,
            set_global_approval,
            set_session_approval,
            get_git_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
