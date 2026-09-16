#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("{}", ahmarius_content_studio_lib::APP_BUILD_VERSION);
        return;
    }
    ahmarius_content_studio_lib::run();
}