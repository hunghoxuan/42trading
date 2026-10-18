import Foundation

@main struct OriginChecks {
    static func main() throws {
        let origin = try TrustedOrigin("https://hunghx.tail02c7f8.ts.net:8443/admin/pos")
        precondition(origin.allows(URL(string: "https://hunghx.tail02c7f8.ts.net:8443/login")))
        precondition(!origin.allows(URL(string: "http://hunghx.tail02c7f8.ts.net:8443/")))
        precondition(!origin.allows(URL(string: "https://hunghx.tail02c7f8.ts.net/")))
        precondition(!origin.allows(URL(string: "https://hunghx.tail02c7f8.ts.net.evil.test:8443/")))
        precondition(!origin.allows(URL(string: "https://user@hunghx.tail02c7f8.ts.net:8443/")))
        precondition(!origin.allows(URL(string: "file:///Users/test/export.html")))
        precondition(!origin.allows(nil))
        precondition(origin.allows(protocol: "https", host: "HUNGHX.tail02c7f8.ts.net", port: 8443))
        precondition(!origin.allows(protocol: "https", host: "hunghx.tail02c7f8.ts.net", port: 443))
        let standard = try TrustedOrigin("https://pos.example.test/")
        precondition(standard.allows(protocol: "https", host: "pos.example.test", port: 0))
        precondition(standard.allows(URL(string: "https://pos.example.test:443/login")))
        precondition(TrustedOrigin.safeFilename("../../stock.xlsx") == ".._.._stock.xlsx")
        precondition(TrustedOrigin.safeFilename("..") == "pos-export")
        precondition(TrustedOrigin.safeFilename("sale\ninvoice.csv") == "sale_invoice.csv")
        do { _ = try TrustedOrigin("http://100.86.192.2:3000/pos/"); fatalError("Accepted HTTP") }
        catch TrustedOrigin.OriginError.invalidURL { }
        print("PASS: HTTPS origin, camera/bridge port boundary, spoofed hosts, credentials, file URLs, and safe export filenames.")
    }
}
