import Foundation
import Photos

/// The Photos library through PhotoKit. Off by default; the permission dialog only appears
/// when the user switches it on (`requestAccess`).
final class PhotosSource: NSObject, PHPhotoLibraryChangeObserver, @unchecked Sendable {
    var onChange: @Sendable () -> Void = {}
    private var observing = false

    static var status: PHAuthorizationStatus { PHPhotoLibrary.authorizationStatus(for: .readWrite) }
    static var allowed: Bool { status == .authorized || status == .limited }

    static func requestAccess() async -> Bool {
        let s = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return s == .authorized || s == .limited
    }

    func startObserving() {
        guard !observing else { return }
        observing = true
        PHPhotoLibrary.shared().register(self)
    }
    func stopObserving() {
        guard observing else { return }
        observing = false
        PHPhotoLibrary.shared().unregisterChangeObserver(self)
    }
    func photoLibraryDidChange(_ changeInstance: PHChange) { onChange() }

    static func assetCount() -> Int {
        guard allowed else { return 0 }
        return PHAsset.fetchAssets(with: fetchOptions()).count
    }

    private static func fetchOptions() -> PHFetchOptions {
        let o = PHFetchOptions()
        o.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d",
                                  PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        return o
    }

    static let source = "photos"

    /// Exports originals not yet on the server, 20 at a time (disk use stays bounded),
    /// hashes them, asks the server, uploads the missing ones and deletes the temp files.
    func sync(pipeline: Pipeline) async -> Pipeline.Report {
        var rep = Pipeline.Report()
        guard Self.allowed else { return rep }
        let result = PHAsset.fetchAssets(with: Self.fetchOptions())
        var todo: [PHAsset] = []
        result.enumerateObjects { a, _, _ in
            let known = pipeline.store.lookup(key: "p:" + a.localIdentifier)
            if known?.uploaded == true { rep.alreadyThere += 1 } else { todo.append(a) }
        }
        rep.files = result.count
        let tmpRoot = FileManager.default.temporaryDirectory.appendingPathComponent("monet-export", isDirectory: true)
        try? FileManager.default.createDirectory(at: tmpRoot, withIntermediateDirectories: true)
        var i = 0
        while i < todo.count {
            if Task.isCancelled { break }
            let group = Array(todo[i..<min(i + 20, todo.count)]); i += 20
            var jobs: [String: UploadJob] = [:]
            var order: [String] = []
            for a in group {
                await pipeline.gate.wait()
                guard let res = Self.original(of: a) else { continue }
                let dir = tmpRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let file = dir.appendingPathComponent(res.originalFilename)
                pipeline.onEvent(.hashing(res.originalFilename))
                guard await Self.export(res, to: file),
                      let sha = try? Hasher256.file(file),
                      let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > 0 else {
                    try? FileManager.default.removeItem(at: dir); rep.failed += 1; continue
                }
                rep.hashed += 1
                let mtime = a.creationDate ?? Date()
                pipeline.store.put(key: "p:" + a.localIdentifier, source: Self.source, size: Int64(size), mtime: mtime.timeIntervalSince1970, sha: sha)
                if jobs[sha] != nil { try? FileManager.default.removeItem(at: dir); continue }
                jobs[sha] = UploadJob(sha: sha, url: file, size: size, name: res.originalFilename,
                                      mtimeMs: Int64(mtime.timeIntervalSince1970 * 1000), source: "mac", deleteWhenDone: true)
                order.append(sha)
            }
            pipeline.onEvent(.hashing(nil))
            let r = await pipeline.checkAndUpload(shas: order) { jobs[$0] }
            // Files of hashes the server already has were not deleted by the uploader.
            for j in jobs.values { try? FileManager.default.removeItem(at: j.url.deletingLastPathComponent()) }
            rep.uploaded += r.done; rep.failed += r.failed; rep.alreadyThere += r.present
        }
        pipeline.onEvent(.scanned(source: Self.source))
        return rep
    }

    private static func original(of a: PHAsset) -> PHAssetResource? {
        let rs = PHAssetResource.assetResources(for: a)
        for t in [PHAssetResourceType.photo, .video, .alternatePhoto, .fullSizePhoto] {
            if let r = rs.first(where: { $0.type == t }) { return r }
        }
        return rs.first
    }

    private static func export(_ r: PHAssetResource, to url: URL) async -> Bool {
        let o = PHAssetResourceRequestOptions()
        o.isNetworkAccessAllowed = true       // iCloud originals are downloaded
        return await withCheckedContinuation { c in
            PHAssetResourceManager.default().writeData(for: r, toFile: url, options: o) { err in c.resume(returning: err == nil) }
        }
    }
}
