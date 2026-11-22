import AppKit

if let code = runCLI(Array(CommandLine.arguments.dropFirst())) { exit(code) }

let app = NSApplication.shared
app.setActivationPolicy(.accessory)          // menu bar only, no Dock icon
let delegate = MainActor.assumeIsolated { MenuBarApp() }
app.delegate = delegate
app.run()
