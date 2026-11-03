# Makerspace Club

## Run locally

1. Install Node.js 22 LTS. Node 26 is not supported by the native SQLite dependency.
   The easiest macOS setup is:

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh)"
   source ~/.zshrc
   nvm install 22
   nvm use 22
   ```

2. In the project folder, remove the failed install and run `npm install`:

   ```bash
   cd "/Users/vivaan/Documents/Club website"
   rm -rf node_modules package-lock.json
   npm install
   ```

3. Copy `.env.example` to `.env`.
4. Set a long random `JWT_SECRET`, a strong `ADMIN_PASSWORD`, and the SMTP settings for your email provider.
5. Run `npm start`.
6. Open `http://localhost:3000`.

The first admin account is created from `ADMIN_EMAIL` and `ADMIN_PASSWORD` the first time the server starts. Member passwords are hashed with bcrypt. Verification codes are sent through the configured SMTP provider and expire after 15 minutes. Until SMTP is configured, signup uses development verification and prints the code in the server terminal; set `DEV_VERIFICATION=false` to require SMTP.

To seed one pre-verified local member account, add `MEMBER_EMAIL` and `MEMBER_PASSWORD` to `.env` before starting the server. The values are hashed at startup and are never stored in source code.
