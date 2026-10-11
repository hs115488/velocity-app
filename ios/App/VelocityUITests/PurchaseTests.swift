import XCTest

final class PurchaseTests: XCTestCase {
    func testSubscribeYearly() {
        let app = XCUIApplication()
        app.launch()

        let pro = app.links["PRO"]
        XCTAssertTrue(pro.waitForExistence(timeout: 8))
        pro.tap()

        let trial = app.buttons["Start 7-day free trial"]
        let subscribe = app.buttons["Subscribe yearly"]
        if trial.waitForExistence(timeout: 4) {
            trial.tap()
        } else {
            XCTAssertTrue(subscribe.waitForExistence(timeout: 4))
            subscribe.tap()
        }

        let sheet = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Subscribe"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 8))
        sheet.tap()

        XCTAssertTrue(app.staticTexts["You're on Pro."].waitForExistence(timeout: 8))
    }
}
