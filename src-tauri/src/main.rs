mod commands;
mod commit_msg;
mod constraints;
mod context;
mod extra_usage;
mod git_commit;
mod git_info;
mod git_ops;
mod live_stats;
mod memories;
mod models_config;
mod omp_update;
mod overlay;
mod plugins;
mod proc;
mod project_files;
mod project_scripts;
mod provider_models;
mod provider_usage;
mod providers;
mod pty;
mod runtime;
mod session_scan;
mod settings;
mod skills;
mod title_prompt;
mod usage;
mod workspace_fs;
mod wsl;

use commands::*;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state = load_state(app.handle());
            app.manage(state);
            // V34：聊天会话进程的闲置回收（内存治理）——常驻 omp 进程每个 0.5–1GB，
            // 「浏览过的会话」不回收就会一直攒；回收后重新打开 / 发消息都会自动 resume。
            runtime::start_idle_reaper(app.handle().clone());
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
            list_workspaces,
            create_workspace,
            update_workspace,
            delete_workspace,
            move_project,
            list_checkouts,
            list_sessions,
            list_archived_sessions,
            archive_sessions,
            unarchive_sessions,
            delete_sessions,
            // 聊天形态（V32 恢复自 V1–V10）：RPC 会话命令面
            context::get_context_breakdown,
            live_stats::get_session_live_stats,
            create_session,
            open_session,
            rename_session,
            get_history,
            send_message,
            steer_message,
            follow_up_message,
            run_slash,
            compact_session,
            branch_session,
            // —— V40（对标 codex / zcode）：队列真值 / 分叉 / 目标 / 旁问 / 统计 / 重启 / diff ——
            remove_queued_message,
            promote_queued_message,
            abort_and_restore_queue,
            fork_session,
            goal_command,
            get_session_stats,
            btw_ask,
            btw_cancel,
            get_btw_history,
            restart_session_runtime,
            git_file_diff,
            // —— V41（对标二期）：子代理 / fast·slow 模式 / 会话导出 ——
            get_subagents,
            cancel_subagent,
            get_subagent_messages,
            set_fast_mode,
            set_slow_mode,
            export_session_html,
            save_paste,
            run_bash,
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
            get_default_thinking_level,
            set_global_approval,
            set_session_approval,
            get_git_info,
            git_commit::get_workspace_git_state,
            git_commit::generate_commit_message,
            git_commit::commit_selected,
            git_commit::start_full_commit,
            git_commit::push_workspace,
            git_commit::cancel_commit_task,
            git_ops::get_change_set,
            git_ops::switch_branch,
            git_ops::pull_workspace,
            git_ops::continue_merge,
            git_ops::abort_merge,
            project_files::list_project_files,
            // —— V42（右栏工作台）：文件目录树 + 终端 ——
            workspace_fs::list_dir,
            workspace_fs::search_paths,
            mention_label,
            pty::terminal_spawn,
            pty::terminal_write,
            pty::terminal_resize,
            pty::terminal_kill,
            // —— V43（右栏工作台）：项目脚本识别 ——
            project_scripts::discover_scripts,
            plugins::list_plugins,
            plugins::set_plugin_enabled,
            plugins::set_plugin_features,
            plugins::install_plugin,
            plugins::uninstall_plugin,
            plugins::plugin_doctor,
            skills::list_skills,
            skills::set_skill_enabled,
            skills::read_skill_file,
            providers::list_providers,
            providers::get_provider_login,
            providers::start_provider_login,
            providers::provider_login_input,
            providers::cancel_provider_login,
            providers::logout_provider,
            providers::get_model_roles,
            providers::set_model_role,
            providers::sync_cycle_order,
            providers::get_fallback_chains,
            providers::set_fallback_chain,
            providers::set_retry_options,
            memories::list_memories,
            memories::read_memory_file,
            memories::delete_memory_file,
            memories::delete_memory_project,
            usage::get_usage_stats,
            provider_usage::get_provider_usage,
            settings::get_omp_settings_catalog,
            settings::set_omp_setting,
            settings::reset_omp_setting,
            // 设置 ›「omp 约束」：全局 AGENTS.md / RULES.md / rules/*.md 的读写
            constraints::get_omp_constraints,
            constraints::write_omp_constraint,
            constraints::create_omp_rule,
            constraints::delete_omp_rule,
            models_config::read_models_config,
            models_config::write_models_config,
            provider_models::fetch_provider_models,
            title_prompt::sync_title_prompt,
            omp_update::check_omp_update,
            omp_update::install_omp,
            omp_update::start_omp_update,
            omp_update::cancel_omp_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 正常退出路径：把全部会话进程收掉（崩溃残留接受为已知边界）。
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                runtime::kill_all(&state.runtime);
                pty::kill_all(&state.terminals);
                git_commit::kill_all(&state.commit_tasks);
                omp_update::kill_update(&state.omp_update_task);
            }
        });
}
