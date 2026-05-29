import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EvolutionService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('evolution.url');
    this.apiKey  = config.getOrThrow<string>('evolution.apiKey');
  }

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.apiKey,
    };
    if (token) h['token'] = token;
    return h;
  }

  async createInstance(name: string, token: string): Promise<{ id: string; name: string }> {
    const res = await fetch(`${this.baseUrl}/instance/create`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ name, token }),
    });
    if (!res.ok) throw new Error(`Evolution create failed: ${await res.text()}`);
    return res.json() as Promise<{ id: string; name: string }>;
  }

  async connectInstance(token: string, webhookUrl: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/connect`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        webhookUrl,
        subscribe: ['MESSAGE', 'connection.update'],
        immediate: true,
      }),
    });
    if (!res.ok) throw new Error(`Evolution connect failed: ${await res.text()}`);
  }

  async getQR(token: string): Promise<{ base64: string }> {
    const res = await fetch(`${this.baseUrl}/instance/qr`, {
      headers: this.headers(token),
    });
    if (!res.ok) throw new Error(`Evolution QR failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    // Evolution Go may return { code } or { base64 }
    const base64 = (data['base64'] ?? data['code'] ?? '') as string;
    return { base64 };
  }

  async pairInstance(token: string, phone: string): Promise<{ code: string }> {
    const res = await fetch(`${this.baseUrl}/instance/pair`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ phone, subscribe: ['MESSAGE', 'connection.update'] }),
    });
    if (!res.ok) throw new Error(`Evolution pair failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return { code: (data['code'] ?? data['pairingCode'] ?? '') as string };
  }

  async getStatus(token: string): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/instance/status`, {
      headers: this.headers(token),
    });
    if (!res.ok) throw new Error(`Evolution status failed: ${res.status} ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return { status: (data['status'] ?? data['state'] ?? 'unknown') as string };
  }

  async deleteInstance(instanceId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/delete/${instanceId}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Evolution delete failed: ${res.status}`);
  }
}
