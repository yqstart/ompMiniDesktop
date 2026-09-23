mod commands;
mod extra_usage;
mod git_commit;
mod git_info;
mod memories;
mod models_config;
mod overlay;
mod provider_usage;
mod providers;
mod pty;
mod session_scan;
mod settings;
mod title_prompt;
mod usage;

use commands::*;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state = load_state(app.handle());
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
            archive_sessions,
            unarchive_sessions,
            delete_sessions,
            get_git_info,
            list_workspaces,
            create_worktree,
            git_commit::get_workspace_git_state,
            git_commit::start_commit_push,
            git_commit::push_commits,
            git_commit::cancel_commit_push,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            providers::list_providers,
            providers::get_provider_login,
            providers::start_provider_login,
            providers::provider_login_input,
            providers::cancel_provider_login,
            providers::logout_provider,
            providers::get_model_roles,
            providers::set_model_role,
            providers::get_cycle_order,
            providers::set_cycle_order,
            providers::get_fallback_chains,
            providers::set_fallback_chain,
            providers::set_retry_options,
            memories::list_memories,
            memories::read_memory_file,
            memories::delete_memory_file,
            memories::delete_memory_project,
            usage::get_usage_stats,
            provider_usage::get_provider_usage,
            settings::get_omp_settings,
            settings::set_omp_setting,
            settings::reset_omp_setting,
            models_config::read_models_config,
            models_config::write_models_config,
            title_prompt::sync_title_prompt
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 正常退出路径：把全部终端 omp 进程收掉（崩溃残留接受为已知边界）。
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                pty::kill_all(&state.pty);
                git_commit::kill_all(&state.commit_tasks);
            }
        });
}
