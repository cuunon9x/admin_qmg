import { Resend } from 'resend'

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev'
const RESEND_TO = process.env.RESEND_TO || 'quangminhgift.qmg@gmail.com'

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function fieldsToHtml(fields) {
  if (!fields || typeof fields !== 'object') return ''
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
  if (!entries.length) return ''

  const items = entries
    .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</li>`)
    .join('')

  return `<ul style="margin: 0; padding-left: 18px;">${items}</ul>`
}

export async function sendResendEmail({ subject, fields = {}, to = RESEND_TO, from = RESEND_FROM }) {
  if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY in server/.env')
  const resend = new Resend(RESEND_API_KEY)

  const safeSubject = subject ? String(subject).trim() : 'QMG - Liên hệ'
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #111;">
      <h2 style="margin: 0 0 12px;">${escapeHtml(safeSubject)}</h2>
      ${fieldsToHtml(fields)}
    </div>
  `

  const text = `${safeSubject}\n\n${Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(([k, v]) => `- ${k}: ${String(v)}`)
    .join('\n')}`

  const result = await resend.emails.send({
    from,
    to,
    subject: safeSubject,
    html,
    text,
  })

  return result
}

