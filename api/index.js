const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Storage file paths (used for local fallback when Vercel KV isn't active)
const STATS_PATH = path.join(__dirname, '..', 'stats.json');
const VISITORS_PATH = path.join(__dirname, '..', 'visitors.json');

// Vercel KV environment variables
const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper to get proxy agent
function getProxyAgent(proxyUrl) {
    if (!proxyUrl) return null;
    try {
        return new HttpsProxyAgent(proxyUrl);
    } catch (e) {
        console.error("Invalid proxy URL:", proxyUrl, e.message);
        return null;
    }
}

// Helper to get time elapsed string
function timeAgo(dateString) {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    
    if (diffSecs < 60) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

// Get Stats (Hybrid KV & Local file)
async function getStats() {
    if (kvUrl && kvToken) {
        try {
            const res = await axios.get(`${kvUrl}/get/stats`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            if (res.data && res.data.result) {
                return JSON.parse(res.data.result);
            }
        } catch (e) {
            console.error("KV get stats error:", e.message);
        }
    }
    
    // Local fallback
    try {
        if (fs.existsSync(STATS_PATH)) {
            return JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
        }
    } catch (err) {
        console.error("Local stats reading failed:", err.message);
    }
    return { total_generated: 0, last_generated: null };
}

// Increment Stats
async function incrementStats() {
    const stats = await getStats();
    stats.total_generated += 1;
    stats.last_generated = new Date().toISOString();

    if (kvUrl && kvToken) {
        try {
            await axios.get(`${kvUrl}/set/stats/${encodeURIComponent(JSON.stringify(stats))}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
        } catch (e) {
            console.error("KV save stats error:", e.message);
        }
    }

    try {
        fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');
    } catch (err) {
        console.error("Local stats writing failed:", err.message);
    }
}

// Save Visitor
async function saveVisitor(visitor) {
    if (kvUrl && kvToken) {
        try {
            // Push to Vercel KV Redis List
            await axios.get(`${kvUrl}/lpush/visitors/${encodeURIComponent(JSON.stringify(visitor))}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            // Trim list to last 50 entries
            await axios.get(`${kvUrl}/ltrim/visitors/0/49`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            return;
        } catch (e) {
            console.error("KV save visitor error:", e.message);
        }
    }

    // Local fallback
    try {
        let visitors = [];
        if (fs.existsSync(VISITORS_PATH)) {
            visitors = JSON.parse(fs.readFileSync(VISITORS_PATH, 'utf-8'));
        }
        visitors.unshift(visitor);
        visitors = visitors.slice(0, 50); // limit to 50
        fs.writeFileSync(VISITORS_PATH, JSON.stringify(visitors, null, 2), 'utf-8');
    } catch (err) {
        console.error("Local visitors writing failed:", err.message);
    }
}

// Get Visitors Log
async function getVisitorsList() {
    if (kvUrl && kvToken) {
        try {
            const res = await axios.get(`${kvUrl}/lrange/visitors/0/19`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            if (res.data && res.data.result) {
                return res.data.result.map(str => JSON.parse(str));
            }
        } catch (e) {
            console.error("KV get visitors error:", e.message);
        }
    }

    // Local fallback
    try {
        if (fs.existsSync(VISITORS_PATH)) {
            return JSON.parse(fs.readFileSync(VISITORS_PATH, 'utf-8'));
        }
    } catch (err) {
        console.error("Local visitors reading failed:", err.message);
    }
    return [];
}

// 1. Stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await getStats();
        res.json({
            total_generated: stats.total_generated,
            last_generated: stats.last_generated ? new Date(stats.last_generated).toLocaleString('en-US') : null,
            last_generated_ago: timeAgo(stats.last_generated)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Logging visitor info
app.post('/api/log-visitor', async (req, res) => {
    try {
        let clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
        clientIp = clientIp.split(',')[0].trim();
        if (clientIp.startsWith('::ffff:')) {
            clientIp = clientIp.substring(7);
        } else if (clientIp === '::1') {
            clientIp = '127.0.0.1';
        }

        // Get geolocation information from Vercel headers if deployed, else fallback to frontend payload
        const country = req.headers['x-vercel-ip-country'] || req.body.country || 'Unknown';
        const city = req.headers['x-vercel-ip-city'] || req.body.city || 'Unknown';
        const region = req.headers['x-vercel-ip-country-region'] || req.body.region || 'Unknown';
        const isp = req.body.isp || 'Unknown';

        const visitor = {
            ip: clientIp,
            country,
            city,
            region,
            isp,
            timestamp: new Date().toISOString()
        };

        await saveVisitor(visitor);
        res.json({ success: true, logged: visitor });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Retrieve visitors list
app.get('/api/visitors', async (req, res) => {
    try {
        const list = await getVisitorsList();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Check coupon eligibility
app.post('/api/check-coupon', async (req, res) => {
    const { bearer_token, coupon, proxy_url } = req.body;
    
    if (!bearer_token) {
        return res.status(400).json({ error: 'Bearer token is required', error_code: 'invalid_token' });
    }
    
    const targetCoupon = coupon || 'plus-1-month-free';
    const url = `https://chatgpt.com/backend-api/promotions/eligibility/${targetCoupon}?type=promo`;
    
    const headers = {
        'Authorization': `Bearer ${bearer_token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Oai-Language': 'en-US',
        'Origin': 'https://chatgpt.com',
        'Referer': 'https://chatgpt.com/',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
    };

    const agent = getProxyAgent(proxy_url);
    const config = {
        headers,
        timeout: 15000,
        ...(agent && { httpsAgent: agent, proxy: false })
    };

    try {
        const response = await axios.get(url, config);
        res.json(response.data);
    } catch (error) {
        console.error("Check coupon error:", error.message);
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data || {};
            
            const isHtml = typeof data === 'string' && (data.includes('<!DOCTYPE html>') || data.includes('<html'));
            
            if (status === 403 && isHtml) {
                return res.status(403).json({
                    error: 'Server IP blocked by OpenAI Cloudflare (403 Forbidden). Please configure SOCKS5/HTTP Proxy in the settings below to bypass detection.',
                    error_code: 'cloudflare_blocked',
                    title: 'Cloudflare IP Blocked'
                });
            }

            if (status === 401 || status === 403) {
                return res.status(status).json({
                    error: 'ChatGPT token expired or invalid.',
                    error_code: 'token_revoked',
                    title: 'Token Expired / Revoked'
                });
            }
            return res.status(status).json({
                error: data.detail || `Server error: ${status}`,
                error_code: data.code || 'api_error'
            });
        }
        res.status(500).json({ error: `Connection failed: ${error.message}` });
    }
});

// 5. Generate Checkout session
app.post('/api/checkout', async (req, res) => {
    const { bearer_token, plan_name, mode, promo_code, country, currency, proxy_url } = req.body;
    
    if (!bearer_token) {
        return res.status(400).json({ error: 'Bearer token is required', error_code: 'invalid_token' });
    }
    
    const url = 'https://chatgpt.com/backend-api/payments/checkout';
    
    const headers = {
        'Authorization': `Bearer ${bearer_token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Oai-Language': 'en-US',
        'Origin': 'https://chatgpt.com',
        'Referer': 'https://chatgpt.com/',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
    };

    const payload = {
        plan_name: plan_name || 'chatgptplusplan',
        checkout_ui_mode: mode || 'hosted',
        billing_details: {
            country: country || 'ID',
            currency: currency || 'IDR'
        },
        cancel_url: 'https://chatgpt.com/',
        promo_code: promo_code || 'plus-1-month-free'
    };

    const agent = getProxyAgent(proxy_url);
    const config = {
        headers,
        timeout: 20000,
        ...(agent && { httpsAgent: agent, proxy: false })
    };

    try {
        const response = await axios.post(url, payload, config);
        
        // Update stats
        await incrementStats();
        
        const data = response.data;
        res.json({
            success: true,
            checkout_ui_mode: data.checkout_ui_mode || payload.checkout_ui_mode,
            checkout_url: data.checkout_url || '',
            openai_pay_url: data.openai_pay_url || '',
            checkout_session_id: data.checkout_session_id || '',
            publishable_key: data.publishable_key || ''
        });
    } catch (error) {
        console.error("Checkout creation error:", error.message);
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data || {};
            
            const isHtml = typeof data === 'string' && (data.includes('<!DOCTYPE html>') || data.includes('<html'));
            
            if (status === 403 && isHtml) {
                return res.status(403).json({
                    success: false,
                    error: 'Server IP blocked by OpenAI Cloudflare (403 Forbidden). Please enable Proxy Settings below.',
                    error_code: 'cloudflare_blocked',
                    title: 'Cloudflare IP Blocked'
                });
            }

            if (status === 401 || status === 403) {
                return res.status(status).json({
                    success: false,
                    error: 'ChatGPT token expired or invalid.',
                    error_code: 'token_revoked',
                    title: 'Token Expired / Revoked'
                });
            }
            return res.status(status).json({
                success: false,
                error: data.detail || `Server error: ${status}`,
                error_code: data.code || 'api_error'
            });
        }
        res.status(500).json({ success: false, error: `Connection failed: ${error.message}` });
    }
});

// 6. Fetch Stripe details
app.post('/api/stripe-init', async (req, res) => {
    const { checkout_session_id, publishable_key } = req.body;
    
    if (!checkout_session_id || !publishable_key) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    const url = `https://api.stripe.com/v1/checkout/sessions/${checkout_session_id}?expand[]=invoice`;
    
    const headers = {
        'Authorization': `Bearer ${publishable_key}`,
        'Accept': 'application/json'
    };

    try {
        const response = await axios.get(url, { headers, timeout: 10000 });
        const data = response.data;
        
        res.json({
            total_summary: {
                due: data.amount_total,
                subtotal: data.amount_subtotal,
                total: data.amount_total
            },
            invoice: data.invoice ? {
                currency: data.currency,
                total_discount_amounts: data.invoice.total_discount_amounts ? data.invoice.total_discount_amounts.map(disc => ({
                    coupon: disc.discountable_model_type === 'coupon' || disc.coupon ? {
                        name: disc.coupon.name || disc.coupon.id,
                        percent_off: disc.coupon.percent_off
                    } : null
                })) : []
            } : null
        });
    } catch (error) {
        console.error("Stripe fetch error:", error.message);
        if (error.response) {
            return res.status(error.response.status).json({
                error: error.response.data.error ? error.response.data.error.message : `Stripe error: ${error.response.status}`
            });
        }
        res.status(500).json({ error: `Connection to Stripe failed: ${error.message}` });
    }
});

// Start listening if run locally (Vercel ignores this and runs serverless-style)
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`ChatGPT Checkout Server running on port ${PORT}`);
    });
}

module.exports = app;
