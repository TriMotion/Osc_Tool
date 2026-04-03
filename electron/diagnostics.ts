import dgram from "dgram";
import OSC from "osc-js";
import { DiagnosticsResult } from "../src/lib/types";
import { EventEmitter } from "events";

export class DiagnosticsRunner extends EventEmitter {
  async runLoopbackTest(
    messageCount: number,
    ratePerSecond: number
  ): Promise<DiagnosticsResult> {
    const sendPort = 57120;
    const listenPort = 57121;

    const receiver = dgram.createSocket("udp4");
    const sender = dgram.createSocket("udp4");

    const latencies: number[] = [];
    let received = 0;

    return new Promise((resolve, reject) => {
      receiver.bind(listenPort, "127.0.0.1", () => {
        receiver.on("message", (buf) => {
          const arriveTime = performance.now();
          try {
            const oscMsg = new OSC.Message();
            oscMsg.unpack(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));
            const sentTime = oscMsg.args[0] as number;
            latencies.push(arriveTime - sentTime);
            received++;

            this.emit("progress", {
              sent: messageCount,
              received,
              total: messageCount,
            });

            if (received === messageCount) {
              cleanup();
            }
          } catch (err) {
            // skip malformed
          }
        });

        const interval = 1000 / ratePerSecond;
        let sent = 0;

        const sendNext = () => {
          if (sent >= messageCount) return;

          const msg = new OSC.Message("/diag/ping", { type: "f", value: performance.now() }, { type: "i", value: sent });
          const binary = msg.pack();
          const buffer = Buffer.from(binary);

          sender.send(buffer, 0, buffer.length, listenPort, "127.0.0.1", () => {
            sent++;
            if (sent < messageCount) {
              setTimeout(sendNext, interval);
            }
          });
        };

        sendNext();

        const timeout = setTimeout(() => {
          cleanup();
        }, (messageCount / ratePerSecond) * 1000 + 3000);

        const cleanup = () => {
          clearTimeout(timeout);
          receiver.close();
          sender.close();

          const sorted = latencies.sort((a, b) => a - b);
          const result: DiagnosticsResult = {
            messagesSent: messageCount,
            messagesReceived: received,
            dropRate: ((messageCount - received) / messageCount) * 100,
            latencyMin: sorted.length > 0 ? sorted[0] : 0,
            latencyAvg: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
            latencyMax: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
            throughput: received / ((messageCount / ratePerSecond) + 0.001),
          };
          resolve(result);
        };
      });

      receiver.on("error", reject);
    });
  }
}
