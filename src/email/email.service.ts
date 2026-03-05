// src/email/email.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;
  private readonly fromEmail: string;
  private readonly frontendUrl: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('resend.apiKey');
    this.resend = new Resend(apiKey);
    this.fromEmail = this.configService.get<string>('resend.fromEmail') || 'noreply@yourdomain.com';
    this.frontendUrl = this.configService.get<string>('frontend.url') || 'http://localhost:3000';
  }

  async sendEmailVerification(email: string, token: string): Promise<void> {
    const verifyUrl = `${this.frontendUrl}/verify-email?token=${token}`;

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: 'Verifikasi Email Akun Anda',
        html: this.buildVerificationEmailHtml(email, verifyUrl),
      });

      this.logger.log(`✅ Verification email sent to: ${email}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send verification email to ${email}: ${error.message}`);
      throw error;
    }
  }

  private buildVerificationEmailHtml(email: string, verifyUrl: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifikasi Email</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);padding:36px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Stouch.id</h1>
              <p style="color:#94a3b8;margin:6px 0 0;font-size:13px;">Binary Option Trading Platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="color:#1e293b;margin:0 0 12px;font-size:20px;font-weight:600;">Verifikasi Email Anda</h2>
              <p style="color:#475569;margin:0 0 24px;font-size:15px;line-height:1.6;">
                Halo! Terima kasih sudah mendaftar di <strong>Stouch.id</strong>.<br>
                Klik tombol di bawah untuk memverifikasi alamat email <strong>${email}</strong>.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 32px;">
                    <a href="${verifyUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                      ✓ Verifikasi Email Sekarang
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;">

              <!-- Info -->
              <p style="color:#64748b;margin:0 0 8px;font-size:13px;line-height:1.6;">
                Link ini akan kadaluarsa dalam <strong>24 jam</strong>.
              </p>
              <p style="color:#64748b;margin:0 0 24px;font-size:13px;line-height:1.6;">
                Jika tombol tidak berfungsi, salin dan tempel link berikut ke browser Anda:
              </p>
              <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin:0;font-size:12px;color:#475569;word-break:break-all;">
                ${verifyUrl}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;">
              <p style="color:#94a3b8;margin:0;font-size:12px;text-align:center;line-height:1.6;">
                Jika Anda tidak mendaftar di Stouch.id, abaikan email ini.<br>
                © ${new Date().getFullYear()} Stouch.id — All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}