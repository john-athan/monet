import Foundation

/// What the indexer WebView reports through `window.monetDarkroom.status`.
/// The web client must expose (all fields optional, unknown ones are ignored):
///   { busy: boolean, label: string, progress: number 0..1, pending: number,
///     items: [{ id: number, done: boolean }] }
/// `items` are the photos currently being worked on (the current one not done, finished ones done).
struct DarkroomStatus: Equatable {
    struct Item: Equatable { var id: Int; var done: Bool }
    var busy = false
    var label: String?
    var progress: Double?
    var pending: Int?
    var items: [Item] = []

    static func parse(_ json: String?) -> DarkroomStatus? {
        guard let json, let d = json.data(using: .utf8),
              let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
        var s = DarkroomStatus()
        s.busy = (o["busy"] as? Bool) ?? false
        s.label = o["label"] as? String
        s.progress = (o["progress"] as? NSNumber).map { min(1, max(0, $0.doubleValue)) }
        s.pending = (o["pending"] as? NSNumber)?.intValue
        for e in (o["items"] as? [Any]) ?? [] {
            if let m = e as? [String: Any], let id = (m["id"] as? NSNumber)?.intValue {
                s.items.append(Item(id: id, done: (m["done"] as? Bool) ?? false))
            } else if let id = (e as? NSNumber)?.intValue {
                s.items.append(Item(id: id, done: false))
            }
        }
        return s
    }
}
