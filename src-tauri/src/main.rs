mod commands;
mod context;
mod git_info;
mod memories;
mod overlay;
mod providers;
mod quota;
mod runtime;
mod session_scan;
mod settings;
mod usage;

use commands::*;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
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
            list_archived_sessions,
            search_sessions,
            create_session,
            open_session,
            archive_session,
            unarchive_session,
            delete_session,
            archive_sessions,
            unarchive_sessions,
            delete_sessions,
            rename_session_note,
            get_history,
            send_message,
            steer_message,
            follow_up_message,
            compact_session,
            branch_session,
            run_slash,
            read_image_file,
            check_paths,
            complete_path,
            stop_session,
            approve,
            respond_ui,
            set_model,
            set_thinking,
            get_session_runtime,
            get_global_approval,
            set_global_approval,
            set_session_approval,
            get_git_info,
            providers::list_providers,
            providers::get_provider_login,
            providers::start_provider_login,
            providers::provider_login_input,
            providers::cancel_provider_login,
            providers::logout_provider,
            providers::get_model_roles,
            providers::set_model_role,
            providers::get_fallback_chains,
            providers::set_fallback_chain,
            providers::set_retry_options,
            memories::list_memories,
            memories::read_memory_file,
            memories::delete_memory_file,
            memories::delete_memory_project,
            usage::get_usage_stats,
            quota::get_provider_usage,
            context::get_context_breakdown,
            settings::get_omp_settings,
            settings::set_omp_setting,
            settings::reset_omp_setting
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
