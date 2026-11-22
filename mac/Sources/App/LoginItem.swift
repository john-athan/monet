import Foundation
import ServiceManagement

enum LoginItem {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    /// Flip it. Returns nil on success, or a message to show.
    static func toggle() -> String? {
        do {
            if isEnabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
            return nil
        } catch {
            return "\(error.localizedDescription)\n\nLege Monet.app in den Ordner „Programme“ und versuche es noch einmal."
        }
    }
}
