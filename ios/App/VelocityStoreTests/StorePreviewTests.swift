import StoreKit
import StoreKitTest
import XCTest

final class StorePreviewTests: XCTestCase {
    func testCatalogLoads() throws {
        let session = try SKTestSession(configurationFileNamed: "Products")
        session.disableDialogs = true
        session.resetToDefaultState()

        let loaded = expectation(description: "products")
        Task {
            let products = try await Product.products(for: ["velocity.pro.yearly", "velocity.pro.monthly"])
            XCTAssertEqual(Set(products.map(\.id)), ["velocity.pro.yearly", "velocity.pro.monthly"])
            loaded.fulfill()
        }
        wait(for: [loaded], timeout: 15)
    }
}
