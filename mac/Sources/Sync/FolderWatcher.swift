import Foundation
import CoreServices

/// FSEvents on a set of folders. The callback fires after the events settle (latency 3 s).
final class FolderWatcher {
    private var stream: FSEventStreamRef?
    private let handler: ([String]) -> Void
    private let queue = DispatchQueue(label: "monet.fsevents")

    init(paths: [String], handler: @escaping ([String]) -> Void) {
        self.handler = handler
        guard !paths.isEmpty else { return }
        var ctx = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                       retain: nil, release: nil, copyDescription: nil)
        let cb: FSEventStreamCallback = { _, info, count, paths, _, _ in
            guard let info else { return }
            let me = Unmanaged<FolderWatcher>.fromOpaque(info).takeUnretainedValue()
            let arr = unsafeBitCast(paths, to: NSArray.self) as? [String] ?? []
            me.handler(Array(arr.prefix(count)))
        }
        stream = FSEventStreamCreate(nil, cb, &ctx, paths as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 3.0,
                                     FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer))
        if let s = stream {
            FSEventStreamSetDispatchQueue(s, queue)
            FSEventStreamStart(s)
        }
    }

    func stop() {
        guard let s = stream else { return }
        FSEventStreamStop(s); FSEventStreamInvalidate(s); FSEventStreamRelease(s)
        stream = nil
    }
    deinit { stop() }
}
