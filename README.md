# ChatGPT Plus Checkout Generator

An elegant, high-performance web application designed to generate official Stripe payment/checkout links for ChatGPT Plus. Equipped with proxy settings to bypass IP limitations, statistics tracking, and Vercel KV-backed visitor logs.

---

## Key Features

- **Official Stripe Payments**: Safely creates hosted checkout sessions directly on official OpenAI Stripe services.
- **Premium Aesthetics**: Features a modern Split-Column Dashboard styled with HSL colors, dynamic floating neon ambient orbs, and native Light/Dark/System theme options.
- **Visitor Geolocation Log**: Real-time IP geolocation resolving (Country, City, ISP/Organization) with privacy-first IP address masking (e.g. `110.137.xxx.xxx`).
- **OpenAI Proxy Support**: Simple configuration interface for HTTP, HTTPS, or SOCKS5 proxies to bypass Cloudflare 403 blocks on datacenter hosting IPs.
- **Usage Statistics Dashboard**: Tracks total links generated, last usage time, and relative timestamps locally or via database KV.
- **Serverless-Ready Architecture**: Runs perfectly as a local Express application and integrates seamlessly as Vercel serverless functions.

---

## Project Structure

```
chatgpt-checkout/
├── api/
│   └── index.js          # Express server entrypoint (Vercel Serverless & Local)
├── public/
│   ├── index.html        # English HTML UI Dashboard & Client Logic
│   ├── style.css         # Custom responsive HSL design & orb animations
│   └── favicon.svg       # Site logo favicon
├── stats.json            # Local fallback stats database
├── visitors.json         # Local fallback visitor logs database
├── package.json          # Node dependencies & scripts
├── vercel.json           # Vercel deployment routing rules
└── README.md             # Project documentation
```

---

## Local Setup & Development

### 1. Install Dependencies
Make sure you have Node.js installed, then run the following in the project root:
```bash
npm install
```

### 2. Start the Local Server
Launch the development server:
```bash
npm run dev
# or
node api/index.js
```
The application will be running at **`http://localhost:3000`**.

---

## Vercel Deployment Guide

Deploying to Vercel takes less than a minute and runs completely free.

### 1. Deployment via CLI
Run the Vercel deployment command in the project directory:
```bash
vercel
```
*Follow the interactive instructions to set up and deploy the project.*

### 2. Connect Vercel KV Database (Optional)
To persist visitor history and usage statistics securely (since serverless directories are read-only):
1. Navigate to your project dashboard on Vercel.
2. Select the **Storage** tab.
3. Click **Create Database** -> select **Vercel KV (Redis)**.
4. Link it to your deployment. Vercel automatically configures `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
5. Redeploy your project using:
   ```bash
   vercel --prod
   ```
Your serverless function will instantly connect to KV Redis!

---

## Technologies Used

- **Backend**: Node.js, Express, Axios
- **Frontend**: HTML5, Vanilla CSS3 (HSL Variables, Keyframes, Flexbox/CSS Grid), Vanilla JS
- **Database**: Vercel KV (Redis) / Local JSON Fallback
- **Hosting**: Vercel / Local Node Server
