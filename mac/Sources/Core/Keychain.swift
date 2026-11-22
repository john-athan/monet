import Foundation
import Security

/// Where the device token lives. The token is never logged and never written anywhere else.
protocol TokenStore: Sendable {
    func load() -> String?
    func save(_ token: String) -> Bool
    func delete()
}

struct KeychainTokenStore: TokenStore {
    static let service = "monet.kaleve.dev"
    static let account = "device-token"

    private var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Self.service,
         kSecAttrAccount as String: Self.account]
    }

    func load() -> String? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    func save(_ token: String) -> Bool {
        delete()
        var q = base
        q[kSecValueData as String] = Data(token.utf8)
        // Readable after the first unlock, never leaves this device (no iCloud Keychain, no backup restore elsewhere).
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func delete() { SecItemDelete(base as CFDictionary) }
}

/// Test only: used by the headless `sync` command with an explicit --home, so a test run
/// never touches the login keychain.
struct FileTokenStore: TokenStore {
    let url: URL
    func load() -> String? { try? String(contentsOf: url, encoding: .utf8) }
    func save(_ token: String) -> Bool {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(token.utf8).write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            return true
        } catch { return false }
    }
    func delete() { try? FileManager.default.removeItem(at: url) }
}
