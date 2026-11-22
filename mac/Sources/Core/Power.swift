import Foundation
import IOKit.ps

enum Power {
    /// (on battery, charge in percent). Percent is nil on a Mac without a battery.
    static func battery() -> (onBattery: Bool, percent: Int?) {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return (false, nil) }
        for ps in list {
            guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any],
                  (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType else { continue }
            let onBattery = (d[kIOPSPowerSourceStateKey] as? String) == kIOPSBatteryPowerValue
            let cur = d[kIOPSCurrentCapacityKey] as? Int
            let max = d[kIOPSMaxCapacityKey] as? Int ?? 100
            return (onBattery, cur.map { max > 0 ? $0 * 100 / max : $0 })
        }
        return (false, nil)
    }

    static func currentReason(userPaused: Bool) -> PausePolicy.Reason? {
        let b = battery()
        return PausePolicy.reason(userPaused: userPaused, onBattery: b.onBattery, batteryPercent: b.percent,
                                  lowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
    }
}
