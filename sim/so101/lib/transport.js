// Byte transports for the Feetech bus — printedrobotics.cz.
// SerialTransport (Web Serial, real Waveshare/Feetech USB bus adapter) and VirtualTransport
// (in-page STS3215 emulator) share one interface, so the wizard code is identical for both:
//
//   await t.open()              connect (SerialTransport asks the user to pick a port)
//   await t.write(Uint8Array)   send bytes
//   await t.read(timeoutMs)     -> Uint8Array: whatever arrived (≥ 1 byte), or empty on timeout
//   t.drain()                   discard buffered input
//   await t.setBaudRate(baud)   reopen at a different baud rate
//   await t.close()
//   t.kind                      'serial' | 'virtual'
//   t.ondisconnect              optional callback (cable unplugged)

export const DEFAULT_BAUD = 1_000_000;

class ByteQueue {
  constructor() { this.chunks = []; this.waiters = []; }
  push(u8) {
    if (!u8 || !u8.length) return;
    this.chunks.push(u8);
    const w = this.waiters.splice(0);
    for (const f of w) f();
  }
  take() {
    if (!this.chunks.length) return new Uint8Array(0);
    if (this.chunks.length === 1) return this.chunks.pop();
    let n = 0; for (const c of this.chunks) n += c.length;
    const out = new Uint8Array(n); let o = 0;
    for (const c of this.chunks) { out.set(c, o); o += c.length; }
    this.chunks.length = 0;
    return out;
  }
  async read(timeoutMs) {
    if (this.chunks.length) return this.take();
    await new Promise((res) => {
      const t = setTimeout(done, Math.max(0, timeoutMs));
      function done() { clearTimeout(t); res(); }
      this.waiters.push(done);
    });
    return this.take();
  }
  clear() { this.chunks.length = 0; }
}

/** In-page transport: bytes go to an emulated bus (`bus.receive(bytes, baud) -> Uint8Array[]`). */
export class VirtualTransport {
  constructor(bus) { this.bus = bus; this.kind = 'virtual'; this.q = new ByteQueue(); this.baud = DEFAULT_BAUD; this.isOpen = false; }
  get label() { return '/dev/ttyACM0 · virtuální Waveshare Bus Servo Adapter'; }
  async open(baud = DEFAULT_BAUD) { this.baud = baud; this.isOpen = true; }
  async close() { this.isOpen = false; this.q.clear(); }
  async setBaudRate(b) { this.baud = b; }
  drain() { this.q.clear(); }
  async write(bytes) {
    if (!this.isOpen) throw new Error('port is closed');
    const replies = this.bus.receive(Uint8Array.from(bytes), this.baud);
    // replies arrive "on the wire" after the request; deliver asynchronously like a real port
    if (replies.length) queueMicrotask(() => { for (const r of replies) this.q.push(r); });
  }
  read(timeoutMs) { return this.q.read(timeoutMs); }
}

export const hasWebSerial = () => typeof navigator !== 'undefined' && 'serial' in navigator;

/**
 * Web Serial transport (Chrome/Edge/Opera on desktop; not Safari, iOS or Firefox).
 * The Waveshare / Feetech bus adapters are half-duplex USB-UART bridges (CH343/CH340):
 * 8N1, 1 Mbaud for STS3215 factory settings.
 */
export class SerialTransport {
  constructor() { this.kind = 'serial'; this.q = new ByteQueue(); this.port = null; this.baud = DEFAULT_BAUD; this.ondisconnect = null; }
  get label() {
    const i = this.port && this.port.getInfo ? this.port.getInfo() : {};
    return 'USB sériový port' + (i.usbVendorId ? ` · VID ${i.usbVendorId.toString(16).padStart(4, '0')} PID ${(i.usbProductId || 0).toString(16).padStart(4, '0')}` : '');
  }
  /** Must be called from a user gesture (click): shows the browser's port picker. */
  async requestPort() {
    if (!hasWebSerial()) throw new Error('Web Serial is not supported');
    this.port = await navigator.serial.requestPort();
    this._onDisc = (e) => { if (e.target === this.port || e.port === this.port) { this._closed(); this.ondisconnect && this.ondisconnect(); } };
    navigator.serial.addEventListener('disconnect', this._onDisc);
    return this.port;
  }
  async open(baud = DEFAULT_BAUD) {
    if (!this.port) await this.requestPort();
    this.baud = baud;
    await this.port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', bufferSize: 4096, flowControl: 'none' });
    this.writer = this.port.writable.getWriter();
    this.reading = this._readLoop();
  }
  async _readLoop() {
    while (this.port && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.q.push(value);
        }
      } catch (e) {
        // framing/parity errors are recoverable: loop and get a new reader; anything else ends the loop
        if (!(e && /Framing|Parity|Break|Overrun|Buffer/i.test(e.name || ''))) break;
      } finally {
        try { this.reader.releaseLock(); } catch (e) {}
        this.reader = null;
      }
      if (this.closing) break;
    }
  }
  drain() { this.q.clear(); }
  async write(bytes) {
    if (!this.writer) throw new Error('port is closed');
    await this.writer.write(Uint8Array.from(bytes));
  }
  read(timeoutMs) { return this.q.read(timeoutMs); }
  async setBaudRate(b) {
    if (b === this.baud && this.writer) return;
    await this.close(true);
    await this.open(b);
  }
  _closed() { this.writer = null; }
  async close(keepPort = false) {
    this.closing = true;
    try { if (this.reader) await this.reader.cancel(); } catch (e) {}
    try { await this.reading; } catch (e) {}
    try { if (this.writer) { this.writer.releaseLock(); } } catch (e) {}
    this.writer = null;
    try { if (this.port) await this.port.close(); } catch (e) {}
    this.closing = false;
    this.q.clear();
    if (!keepPort) {
      if (this._onDisc && hasWebSerial()) navigator.serial.removeEventListener('disconnect', this._onDisc);
      this.port = null;
    }
  }
}
