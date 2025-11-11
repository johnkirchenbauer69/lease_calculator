# 1) Use Playwright’s image that already includes Chromium, Firefox, WebKit and OS libs
FROM mcr.microsoft.com/playwright:v1.43.1-jammy

# 2) Put our app in /app
WORKDIR /app

# 3) Install only production deps (no dev) — use install (not ci) in case no lockfile
COPY package*.json ./
RUN npm install --omit=dev

# 4) Copy the rest of the code
COPY . .

# 5) Tell Node we’re in production
ENV NODE_ENV=production

# 6) Start our server
CMD ["node", "server.js"]
