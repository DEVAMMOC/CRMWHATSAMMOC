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

  /** Admin endpoints — use global API key */
  private adminHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', apikey: this.apiKey };
  }

  /**
   * Instance-specific endpoints — Evolution Go authenticates these
   * using the instance's own token as the `apikey` header value.
   */
  private instanceHeaders(token: string): Record<string, string> {
    return { 'Content-Type': 'application/json', apikey: token };
  }

  /**
   * Find an existing instance by name using the /instance/all endpoint.
   * Returns id, name, and token from the Evolution Go registry.
   */
  private async findInstanceByName(name: string): Promise<{ id: string; name: string; token: string }> {
    const res = await fetch(`${this.baseUrl}/instance/all`, {
      headers: this.adminHeaders(),
    });
    if (!res.ok) throw new Error(`Evolution list failed: ${await res.text()}`);
    const result = await res.json() as { data: Array<{ id: string; name: string; token: string }> };
    const found = result.data.find(i => i.name === name);
    if (!found) throw new Error(`Instance not found after conflict: ${name}`);
    return { id: found.id, name: found.name, token: found.token };
  }

  /**
   * Create an instance, or return the existing one if the name is already taken.
   * Returns the actual token stored in Evolution Go (may differ if instance was
   * created previously with a different token).
   */
  async createOrFindInstance(name: string, token: string): Promise<{ id: string; name: string; token: string }> {
    const res = await fetch(`${this.baseUrl}/instance/create`, {
      method: 'POST',
      headers: this.adminHeaders(),
      body: JSON.stringify({ name, token }),
    });

    if (!res.ok) {
      const errText = await res.text();
      // Gracefully handle duplicate — find and return existing instance
      if (errText.includes('already exists')) {
        return this.findInstanceByName(name);
      }
      throw new Error(`Evolution create failed: ${errText}`);
    }

    // Response: { data: { id, name, token, ... }, message: "success" }
    const result = await res.json() as { data: { id: string; name: string; token: string } };
    return {
      id: result.data.id ?? result.data.name,
      name: result.data.name,
      token: result.data.token ?? token,
    };
  }

  async connectInstance(token: string, webhookUrl: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/connect`, {
      method: 'POST',
      headers: this.instanceHeaders(token),
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
      headers: this.instanceHeaders(token),
    });
    if (!res.ok) throw new Error(`Evolution QR failed: ${res.status} ${await res.text()}`);
    // Response: { data: { Qrcode: "data:image/png;base64,...", Code: "..." }, message }
    const result = await res.json() as { data: { Qrcode?: string; Code?: string } };
    const base64 = result.data.Qrcode ?? result.data.Code ?? '';
    return { base64 };
  }

  async pairInstance(token: string, phone: string): Promise<{ code: string }> {
    const res = await fetch(`${this.baseUrl}/instance/pair`, {
      method: 'POST',
      headers: this.instanceHeaders(token),
      body: JSON.stringify({ phone, subscribe: ['MESSAGE', 'connection.update'] }),
    });
    if (!res.ok) throw new Error(`Evolution pair failed: ${await res.text()}`);
    // Response: { data: { PairingCode: "XXXX-XXXX" }, message }
    const result = await res.json() as { data: { PairingCode?: string } };
    return { code: result.data.PairingCode ?? '' };
  }

  async getStatus(token: string): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/instance/status`, {
      headers: this.instanceHeaders(token),
    });
    if (!res.ok) throw new Error(`Evolution status failed: ${res.status} ${await res.text()}`);
    // Response: { data: { Connected: bool, LoggedIn: bool, Name: "" }, message }
    const result = await res.json() as { data: { Connected: boolean; LoggedIn: boolean } };
    return { status: result.data.Connected ? 'connected' : 'disconnected' };
  }

  async sendText(token: string, to: string, text: string): Promise<void> {
    // Evolution Go endpoint: POST /send/text
    // `formatJid: true` lets Evolution Go handle the @s.whatsapp.net suffix automatically
    const res = await fetch(`${this.baseUrl}/send/text`, {
      method: 'POST',
      headers: this.instanceHeaders(token),
      body: JSON.stringify({ number: to, text, formatJid: true }),
    });
    if (!res.ok) throw new Error(`Evolution sendText failed: ${res.status} ${await res.text()}`);
  }

  async deleteInstance(instanceId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/delete/${instanceId}`, {
      method: 'DELETE',
      headers: this.adminHeaders(),
    });
    if (!res.ok) throw new Error(`Evolution delete failed: ${res.status}`);
  }
}
