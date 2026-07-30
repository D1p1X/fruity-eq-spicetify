import AudioToolbox
import CoreAudio
import Foundation

struct EqBand: Codable {
    let frequency: Float
    let gain: Float
    let q: Float
    let type: String
    let active: Bool?
}

struct BridgeCommand: Codable {
    let command: String?
    let bands: [EqBand]?
    let enabled: Bool?
    let preamp: Float?
}

enum BridgeError: Error, LocalizedError {
    case status(OSStatus, String)
    case deviceNotFound(String)

    var errorDescription: String? {
        switch self {
        case let .status(code, action): return "\(action) failed (CoreAudio \(code))"
        case let .deviceNotFound(name): return "Audio device not found: \(name)"
        }
    }
}

func require(_ status: OSStatus, _ action: String) throws {
    guard status == noErr else { throw BridgeError.status(status, action) }
}

func send(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload),
          let message = String(data: data, encoding: .utf8) else { return }
    print(message)
    fflush(stdout)
}

func device(named name: String) throws -> AudioDeviceID {
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    try require(AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size), "listing audio devices")
    var devices = Array(repeating: AudioDeviceID(), count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    try require(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices), "reading audio devices")
    for id in devices {
        var nameAddress = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var deviceName: CFString = "" as CFString
        var nameSize = UInt32(MemoryLayout<CFString>.size)
        let status = withUnsafeMutableBytes(of: &deviceName) { bytes in
            AudioObjectGetPropertyData(id, &nameAddress, 0, nil, &nameSize, bytes.baseAddress!)
        }
        guard status == noErr else { continue }
        if (deviceName as String).localizedCaseInsensitiveCompare(name) == .orderedSame { return id }
    }
    throw BridgeError.deviceNotFound(name)
}

func defaultDevice(_ selector: AudioObjectPropertySelector) throws -> AudioDeviceID {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var id = AudioDeviceID()
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    try require(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id), "reading default audio device")
    return id
}

func deviceUID(_ id: AudioDeviceID) throws -> CFString {
    var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceUID, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var uid: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutableBytes(of: &uid) { bytes in
        AudioObjectGetPropertyData(id, &address, 0, nil, &size, bytes.baseAddress!)
    }
    try require(status, "reading audio device UID")
    return uid
}

func setDefaultDevice(_ selector: AudioObjectPropertySelector, _ id: AudioDeviceID) throws {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var target = id
    try require(AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &target), "setting default audio device")
}

struct Coefficients {
    let b0: Float
    let b1: Float
    let b2: Float
    let a1: Float
    let a2: Float
}

func coefficients(for band: EqBand, sampleRate: Float) -> Coefficients {
    if band.active == false { return Coefficients(b0: 1, b1: 0, b2: 0, a1: 0, a2: 0) }
    let f = min(max(band.frequency, 20), 20_000)
    let q = max(band.q, 0.15)
    let omega = 2 * Float.pi * f / sampleRate
    let sinW = sin(omega)
    let cosW = cos(omega)
    let alpha = sinW / (2 * q)
    let a = pow(10, band.gain / 40)
    var b0: Float = 1, b1: Float = 0, b2: Float = 0, a0: Float = 1, a1: Float = 0, a2: Float = 0

    switch band.type {
    case "highpass":
        b0 = (1 + cosW) / 2; b1 = -(1 + cosW); b2 = b0
        a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha
    case "lowpass":
        b0 = (1 - cosW) / 2; b1 = 1 - cosW; b2 = b0
        a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha
    case "bandpass":
        b0 = alpha; b1 = 0; b2 = -alpha
        a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha
    case "notch":
        b0 = 1; b1 = -2 * cosW; b2 = 1
        a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha
    case "allpass":
        b0 = 1 - alpha; b1 = -2 * cosW; b2 = 1 + alpha
        a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha
    case "lowshelf", "highshelf":
        // AVAudio's shelf Q is slope-like; clamp the equivalent RBJ slope so
        // the audible curve remains stable at extreme user Q values.
        let slope = min(max(1 / q, 0.1), 1.0)
        let shelfAlpha = sinW / 2 * sqrt((a + 1 / a) * (1 / slope - 1) + 2)
        let twoRootAAlpha = 2 * sqrt(a) * shelfAlpha
        if band.type == "lowshelf" {
            b0 = a * ((a + 1) - (a - 1) * cosW + twoRootAAlpha)
            b1 = 2 * a * ((a - 1) - (a + 1) * cosW)
            b2 = a * ((a + 1) - (a - 1) * cosW - twoRootAAlpha)
            a0 = (a + 1) + (a - 1) * cosW + twoRootAAlpha
            a1 = -2 * ((a - 1) + (a + 1) * cosW)
            a2 = (a + 1) + (a - 1) * cosW - twoRootAAlpha
        } else {
            b0 = a * ((a + 1) + (a - 1) * cosW + twoRootAAlpha)
            b1 = -2 * a * ((a - 1) + (a + 1) * cosW)
            b2 = a * ((a + 1) + (a - 1) * cosW - twoRootAAlpha)
            a0 = (a + 1) - (a - 1) * cosW + twoRootAAlpha
            a1 = 2 * ((a - 1) - (a + 1) * cosW)
            a2 = (a + 1) - (a - 1) * cosW - twoRootAAlpha
        }
    default: // peaking
        b0 = 1 + alpha * a; b1 = -2 * cosW; b2 = 1 - alpha * a
        a0 = 1 + alpha / a; a1 = -2 * cosW; a2 = 1 - alpha / a
    }
    return Coefficients(b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0)
}

final class FloatRing {
    private let lock = NSLock()
    private var queue: [[Float]] = []
    private let capacity = 32

    func push(_ samples: [Float]) {
        lock.lock(); defer { lock.unlock() }
        if queue.count >= capacity { queue.removeFirst() }
        queue.append(samples)
    }

    func pop(frameCount: Int) -> [Float]? {
        lock.lock(); defer { lock.unlock() }
        guard !queue.isEmpty else { return nil }
        let samples = queue.removeFirst()
        guard samples.count == frameCount * 2 else { return nil }
        return samples
    }
}

final class AudioBridge {
    private let inputName: String
    private let outputName: String
    private let sampleRate: Float = 48_000
    private let frameCount = 1024
    private let ring = FloatRing()
    private let parameterLock = NSLock()
    private var filters = Array(repeating: Coefficients(b0: 1, b1: 0, b2: 0, a1: 0, a2: 0), count: 7)
    private var enabled = true
    private var preamp: Float = 0
    private var stateLeft = Array(repeating: Array(repeating: (Float(0), Float(0)), count: 7), count: 2)
    private var outputQueue: AudioQueueRef?
    private var originalOutput: AudioDeviceID?
    private var originalSystemOutput: AudioDeviceID?
    private var captureProcess: Process?
    private var capturePipe: Pipe?
    private var captureBytes = Data()
    private var active = false
    private var packetsProcessed = 0
    private var peak = Float(0)

    init(inputName: String, outputName: String) {
        self.inputName = inputName
        self.outputName = outputName
    }

    func start() throws {
        let inputDevice = try device(named: inputName)
        originalOutput = try defaultDevice(kAudioHardwarePropertyDefaultOutputDevice)
        originalSystemOutput = try defaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice)
        // Spotify follows the system output into BlackHole. The output AudioQueue
        // is pinned to the physical speaker by UID and therefore cannot loop.
        try setDefaultDevice(kAudioHardwarePropertyDefaultOutputDevice, inputDevice)
        try setDefaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice, inputDevice)

        try startOutputQueue()
        try startCapture()
        active = true
        send(["type": "status", "state": "active", "input": inputName, "output": outputName, "sampleRate": sampleRate])
    }

    private func captureDeviceIndex() throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["ffmpeg", "-nostdin", "-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]
        let stderr = Pipe()
        process.standardError = stderr
        process.standardOutput = Pipe()
        try process.run()
        process.waitUntilExit()
        let listing = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        var inAudioSection = false
        for rawLine in listing.split(separator: "\n") {
            let line = String(rawLine)
            if line.contains("AVFoundation audio devices:") { inAudioSection = true; continue }
            guard inAudioSection, let marker = line.range(of: "\\[[0-9]+\\]\\s+", options: .regularExpression) else { continue }
            let index = String(line[marker]).filter(\.isNumber)
            let name = line[marker.upperBound...].trimmingCharacters(in: .whitespaces)
            if name.localizedCaseInsensitiveCompare(inputName) == .orderedSame { return index }
        }
        throw BridgeError.deviceNotFound(inputName)
    }

    private func startCapture() throws {
        let index = try captureDeviceIndex()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", ":\(index)", "-ac", "2", "-ar", "48000", "-f", "f32le", "pipe:1"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty { self?.consumeCapture(data) }
        }
        try process.run()
        captureProcess = process
        capturePipe = pipe
    }

    private func consumeCapture(_ data: Data) {
        captureBytes.append(data)
        let byteCount = frameCount * 2 * MemoryLayout<Float>.size
        while captureBytes.count >= byteCount {
            let frame = captureBytes.prefix(byteCount)
            captureBytes.removeFirst(byteCount)
            let samples = frame.withUnsafeBytes { raw -> [Float] in
                Array(raw.bindMemory(to: Float.self))
            }
            consume(samples)
        }
    }

    private func startOutputQueue() throws {
        var format = AudioStreamBasicDescription(
            mSampleRate: Float64(sampleRate), mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 8, mFramesPerPacket: 1, mBytesPerFrame: 8,
            mChannelsPerFrame: 2, mBitsPerChannel: 32, mReserved: 0
        )
        var queue: AudioQueueRef?
        try require(AudioQueueNewOutput(&format, outputCallback, Unmanaged.passUnretained(self).toOpaque(), nil, nil, 0, &queue), "creating speaker queue")
        guard let queue else { throw BridgeError.status(-1, "creating speaker queue") }
        var outputUID = try deviceUID(device(named: outputName))
        let deviceStatus = withUnsafeBytes(of: &outputUID) { bytes in
            AudioQueueSetProperty(queue, kAudioQueueProperty_CurrentDevice, bytes.baseAddress!, UInt32(MemoryLayout<CFString>.size))
        }
        try require(deviceStatus, "choosing physical speaker")
        for _ in 0 ..< 4 {
            var buffer: AudioQueueBufferRef?
            try require(AudioQueueAllocateBuffer(queue, UInt32(frameCount * 2 * MemoryLayout<Float>.size), &buffer), "allocating speaker buffer")
            guard let buffer else { throw BridgeError.status(-1, "allocating speaker buffer") }
            fill(buffer, queue)
        }
        try require(AudioQueueStart(queue, nil), "starting speaker queue")
        outputQueue = queue
    }

    private func consume(_ input: [Float]) {
        guard input.count == frameCount * 2 else { return }
        parameterLock.lock()
        let localFilters = filters
        let isEnabled = enabled
        let gain = isEnabled ? pow(10, preamp / 20) : 1
        parameterLock.unlock()
        var output = Array(repeating: Float(0), count: frameCount * 2)
        for frame in 0 ..< frameCount {
            for channel in 0 ..< 2 {
                var value = input[frame * 2 + channel]
                if isEnabled {
                    for index in 0 ..< localFilters.count {
                        let filter = localFilters[index]
                        let state = stateLeft[channel][index]
                        let next = filter.b0 * value + state.0
                        stateLeft[channel][index] = (filter.b1 * value - filter.a1 * next + state.1, filter.b2 * value - filter.a2 * next)
                        value = next
                    }
                    value *= gain
                }
                output[frame * 2 + channel] = max(-1, min(value, 1))
            }
        }
        ring.push(output)
        let packetPeak = output.reduce(Float(0)) { max($0, abs($1)) }
        parameterLock.lock()
        packetsProcessed += 1
        // Keep the meter truthful to the most recent audio buffer. The bridge
        // reports it on demand, so an aggressively decaying historic maximum
        // would make a live signal appear silent between configuration changes.
        peak = packetPeak
        parameterLock.unlock()
    }

    func fill(_ buffer: AudioQueueBufferRef, _ queue: AudioQueueRef) {
        let frames = frameCount
        let samples = ring.pop(frameCount: frames) ?? Array(repeating: Float(0), count: frames * 2)
        samples.withUnsafeBytes { source in
            guard let address = source.baseAddress else { return }
            memcpy(buffer.pointee.mAudioData, address, samples.count * MemoryLayout<Float>.size)
        }
        buffer.pointee.mAudioDataByteSize = UInt32(samples.count * MemoryLayout<Float>.size)
        _ = AudioQueueEnqueueBuffer(queue, buffer, 0, nil)
    }

    func apply(_ command: BridgeCommand) {
        guard active else { return }
        parameterLock.lock()
        if let enabled = command.enabled { self.enabled = enabled }
        if let preamp = command.preamp { self.preamp = min(max(preamp, -12), 12) }
        if let bands = command.bands, bands.count == 7 {
            filters = bands.map { coefficients(for: $0, sampleRate: sampleRate) }
            stateLeft = Array(repeating: Array(repeating: (Float(0), Float(0)), count: 7), count: 2)
        }
        let packets = packetsProcessed
        let peakDb = peak > 0 ? 20 * log10(peak) : -120
        parameterLock.unlock()
        send(["type": "status", "state": "active", "updated": true, "packets": packets, "peakDb": peakDb])
    }

    func stop() {
        capturePipe?.fileHandleForReading.readabilityHandler = nil
        captureProcess?.terminate()
        if let outputQueue { AudioQueueStop(outputQueue, true); AudioQueueDispose(outputQueue, true) }
        if let originalOutput { try? setDefaultDevice(kAudioHardwarePropertyDefaultOutputDevice, originalOutput) }
        if let originalSystemOutput { try? setDefaultDevice(kAudioHardwarePropertyDefaultSystemOutputDevice, originalSystemOutput) }
        active = false
        send(["type": "status", "state": "stopped"])
        exit(0)
    }
}

private let outputCallback: AudioQueueOutputCallback = { userData, queue, buffer in
    guard let userData else { return }
    let bridge = Unmanaged<AudioBridge>.fromOpaque(userData).takeUnretainedValue()
    bridge.fill(buffer, queue)
}

let args = Array(CommandLine.arguments.dropFirst())
let bridge = AudioBridge(inputName: args.first ?? "BlackHole 2ch", outputName: args.dropFirst().first ?? "Reproduktory MacBook Air")

DispatchQueue.main.async {
    do { try bridge.start() }
    catch { send(["type": "status", "state": "error", "detail": error.localizedDescription]); exit(1) }
}

DispatchQueue.global(qos: .userInitiated).async {
    let decoder = JSONDecoder()
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let command = try? decoder.decode(BridgeCommand.self, from: data) else {
            send(["type": "status", "state": "error", "detail": "Invalid bridge command"])
            continue
        }
        DispatchQueue.main.async { command.command == "stop" ? bridge.stop() : bridge.apply(command) }
    }
}

RunLoop.main.run()
