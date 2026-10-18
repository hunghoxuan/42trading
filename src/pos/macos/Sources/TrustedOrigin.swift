import Foundation

struct TrustedOrigin {
    let url: URL
    let origin: String

    init(_ value: String) throws {
        guard let url = URL(string: value), url.scheme?.lowercased() == "https",
              let host = url.host, url.user == nil, url.password == nil,
              url.fragment == nil else { throw OriginError.invalidURL }
        self.url = url
        origin = "https://" + host.lowercased() + ((url.port ?? 443) == 443 ? "" : ":\(url.port!)")
    }

    func allows(_ candidate: URL?) -> Bool {
        guard let candidate = candidate else { return false }
        return candidate.scheme?.lowercased() == "https"
            && candidate.host?.lowercased() == url.host?.lowercased()
            && (candidate.port ?? 443) == (url.port ?? 443)
            && candidate.user == nil && candidate.password == nil
    }

    func allows(protocol scheme: String, host: String, port: Int) -> Bool {
        scheme.lowercased() == "https" && host.lowercased() == url.host?.lowercased()
            && (port == 0 ? 443 : port) == (url.port ?? 443)
    }

    static func safeFilename(_ value: String) -> String {
        let invalid = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "/\\:"))
        let name = value.components(separatedBy: invalid).joined(separator: "_").trimmingCharacters(in: .whitespaces)
        return name.isEmpty || name == "." || name == ".." ? "pos-export" : String(name.prefix(150))
    }

    enum OriginError: Error { case invalidURL }
}
