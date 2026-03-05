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
    // Strip trailing slash to prevent double-slash in URL
    const baseUrl = this.frontendUrl.replace(/\/$/, '');
    const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: email,
        subject: 'Verifikasi Alamat Email Anda — Stouch.id',
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
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifikasi Alamat Email — Stouch.id</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:40px 48px;text-align:center;">
              <h1 style="color:#ffffff;margin:0 0 4px;font-size:26px;font-weight:800;letter-spacing:-0.5px;">Stouch.id</h1>
              <p style="color:#94a3b8;margin:0;font-size:12px;letter-spacing:0.5px;text-transform:uppercase;">Binary Option Trading Platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:44px 48px 36px;">

              <h2 style="color:#0f172a;margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.3;">
                Verifikasi Alamat Email Anda
              </h2>

              <p style="color:#475569;margin:0 0 12px;font-size:15px;line-height:1.7;">
                Selamat datang di Stouch.id.
              </p>
              <p style="color:#475569;margin:0 0 32px;font-size:15px;line-height:1.7;">
                Untuk menyelesaikan pendaftaran dan mengaktifkan akun Anda, silakan konfirmasi bahwa <strong style="color:#1e293b;">${email}</strong> adalah alamat email yang Anda gunakan.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:36px;">
                    <a href="${verifyUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#ffffff;text-decoration:none;padding:15px 40px;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.3px;">
                      Konfirmasi Alamat Email
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 28px;">

              <!-- Info notes -->
              <table cellpadding="0" cellspacing="0" style="width:100%;">
                <tr>
                  <td style="padding:0 0 10px;">
                    <p style="color:#64748b;margin:0;font-size:13px;line-height:1.7;">
                      <strong style="color:#475569;">Tautan ini berlaku selama 24 jam</strong> sejak email dikirimkan.
                      Setelah itu, Anda perlu meminta tautan verifikasi baru melalui halaman profil akun Anda.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0 0;">
                    <p style="color:#64748b;margin:0 0 10px;font-size:13px;line-height:1.7;">
                      Jika tombol di atas tidak dapat diklik, salin tautan berikut dan tempel langsung di address bar browser Anda:
                    </p>
                    <p style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:0;font-size:12px;color:#475569;word-break:break-all;line-height:1.6;">
                      ${verifyUrl}
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Security note -->
          <tr>
            <td style="padding:0 48px 32px;">
              <table cellpadding="0" cellspacing="0" style="width:100%;background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
                <tr>
                  <td>
                    <p style="color:#92400e;margin:0;font-size:12px;line-height:1.7;">
                      <strong>Tidak merasa mendaftar?</strong> Abaikan email ini. Akun Anda tidak akan diaktifkan selama tautan ini tidak diklik, dan data Anda tetap aman.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 48px;border-top:1px solid #e2e8f0;">
              <p style="color:#94a3b8;margin:0;font-size:12px;text-align:center;line-height:1.8;">
                Email ini dikirim secara otomatis oleh sistem Stouch.id.<br>
                Mohon tidak membalas email ini.<br>
                © ${new Date().getFullYear()} Stouch.id — Verte Securities Limited. All rights reserved.
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