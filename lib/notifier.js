const nodemailer = require('nodemailer');
const logger     = require('./logger');

class Notifier {
  constructor() {
    this.config = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || '"MongoDB Monitor" <monitor@example.com>'
    };

    this.transporter = null;
    if (this.config.host && this.config.user && this.config.pass) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.port === 465,
        auth: {
          user: this.config.user,
          pass: this.config.pass
        }
      });
      logger.info(`SMTP configured: ${this.config.host}:${this.config.port}`);
    } else {
      logger.info('SMTP not configured. Alerts will be logged to console only.');
    }
  }

  async sendEmail(to, subject, text, html) {
    if (!to || (Array.isArray(to) && to.length === 0)) return;

    const mailOptions = {
      from: this.config.from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html
    };

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail(mailOptions);
        logger.info(`Email sent: ${info.messageId}`);
        return info;
      } catch (error) {
        logger.error(`Email send failed: ${error.message}`);
      }
    } else {
      logger.info('─── EMAIL NOTIFICATION (LOG ONLY) ───');
      logger.info(`To:      ${mailOptions.to}`);
      logger.info(`Subject: ${mailOptions.subject}`);
      logger.info(`Body:    ${mailOptions.text}`);
      logger.info('────────────────────────────────────');
    }
  }

  async notifyCriticalAlert(alert, recipients) {
    if (!recipients || recipients.length === 0) return;

    const subject = `[CRITICAL] MongoDB Alert: ${alert.title}`;
    const text = `
Critical Alert Detected!
Title: ${alert.title}
Message: ${alert.message}
Node: ${alert.nodeId || 'N/A'}
Time: ${new Date(alert.ts).toLocaleString()}

Please check the MongoDB Cluster Monitor dashboard for more details.
    `;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #d03535; border-radius: 8px;">
        <h2 style="color: #d03535;">Critical Alert Detected</h2>
        <p><strong>Title:</strong> ${alert.title}</p>
        <p><strong>Message:</strong> ${alert.message}</p>
        <p><strong>Node:</strong> ${alert.nodeId || 'N/A'}</p>
        <p><strong>Time:</strong> ${new Date(alert.ts).toLocaleString()}</p>
        <hr />
        <p style="font-size: 12px; color: #666;">This is an automated notification from the MongoDB Cluster Monitor.</p>
      </div>
    `;

    return this.sendEmail(recipients, subject, text, html);
  }
}

module.exports = new Notifier();
