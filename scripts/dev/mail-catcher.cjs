// Dev-only SMTP catcher: accepts any mail on 127.0.0.1:1025 and appends it to mails.jsonl.
const { SMTPServer } = require('smtp-server'); const { simpleParser } = require('mailparser'); const fs = require('fs'); const path = require('path')
const out = path.join(__dirname, 'mails.jsonl')
new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onAuth(a, s, cb) { cb(null, { user: 'dev' }) },
  onData(stream, s, cb) { simpleParser(stream).then(m => { fs.appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), to: m.to?.text, subject: m.subject, text: m.text }) + '\n'); cb() }).catch(cb) } }).listen(1025, '127.0.0.1', () => console.log('catcher on 1025'))
