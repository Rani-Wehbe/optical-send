/**
 * OpticalScanner: Camera scanning with jsQR
 *
 * Implements:
 * - Camera initialization via getUserMedia
 * - Continuous frame capture and QR decoding
 * - FPS/throughput metrics
 * - Torch/flashlight control
 * - Error handling and degradation
 */

import jsQR from 'jsqr';

export interface ScanResult {
  data: string; // JSON frame data
  timestamp: Date;
  confidence?: number;
}

/**
 * Camera scanning handler with continuous QR detection
 */
export class CameraScanner {
  private video?: HTMLVideoElement;
  private canvas?: HTMLCanvasElement;
  private stream?: MediaStream;
  private scanning = false;
  private onScanCallback?: (result: ScanResult) => void;
  private frameCount = 0;
  private lastFrameTime = Date.now();
  private ctx?: CanvasRenderingContext2D | null;

  async initialize(videoElement: HTMLVideoElement): Promise<void> {
    this.video = videoElement;
    this.canvas = document.createElement('canvas');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (this.video) {
        this.video.srcObject = this.stream;
        await new Promise<void>((resolve) => {
          if (!this.video) return;
          this.video.onloadedmetadata = () => {
            this.video!.play();
            resolve();
          };
        });

        this.ctx = this.canvas.getContext('2d');
      }
    } catch (error) {
      console.error('Camera access denied or unavailable:', error);
      throw error;
    }
  }

  start(onScan: (result: ScanResult) => void): void {
    this.onScanCallback = onScan;
    this.scanning = true;
    this.scanLoop();
  }

  stop(): void {
    this.scanning = false;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }
  }

  private async scanLoop(): Promise<void> {
    if (!this.scanning || !this.video || !this.canvas || !this.ctx) {
      return;
    }

    try {
      // Draw video frame to canvas
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.ctx.drawImage(this.video, 0, 0);

      const imageData = this.ctx.getImageData(
        0,
        0,
        this.canvas.width,
        this.canvas.height
      );

      // Decode QR with jsQR
      const qrCode = jsQR(imageData.data, imageData.width, imageData.height);

      if (qrCode) {
        this.frameCount++;
        this.onScanCallback?.({
          data: qrCode.data,
          timestamp: new Date(),
          confidence: qrCode.binaryData ? 1 : 0.8,
        });
      }
    } catch (error) {
      console.error('Scan error:', error);
    }

    requestAnimationFrame(() => this.scanLoop());
  }

  getMetrics(): { framesPerSecond: number; totalFrames: number } {
    const now = Date.now();
    const elapsed = (now - this.lastFrameTime) / 1000;
    const fps = this.frameCount / Math.max(elapsed, 0.001);
    this.frameCount = 0;
    this.lastFrameTime = now;
    return { framesPerSecond: fps, totalFrames: this.frameCount };
  }

  async toggleTorch(on: boolean): Promise<void> {
    if (!this.stream) return;

    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
      const imageCapture = new ImageCapture(videoTrack);
      const capabilities = await imageCapture.getPhotoCapabilities();

      // Check if torch is supported
      const constraints: any = {};
      if ('torch' in capabilities) {
        constraints.advanced = [{ torch: on }];
        await videoTrack.applyConstraints(constraints);
      }
    } catch (error) {
      console.warn('Torch not available or already controlled:', error);
    }
  }

  isAvailable(): boolean {
    return !!this.stream && this.scanning;
  }

  getVideoElement(): HTMLVideoElement | undefined {
    return this.video;
  }
}
