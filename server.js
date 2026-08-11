import express from 'express';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import chromium from '@sparticuz/chromium';


// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// In-memory session store and rate limit map
const activeSessions = new Set();
const loginAttempts = new Map();

// Parse cookies helper
function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
}

// Rate limit middleware for login (5 attempts per minute max)
function loginRateLimiter(req, res, next) {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    const limitWindow = 60 * 1000; // 1 minute
    const maxAttempts = 5;

    const attempts = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };

    if (attempts.count >= maxAttempts && (now - attempts.lastAttempt) < limitWindow) {
        const resetTime = Math.ceil((limitWindow - (now - attempts.lastAttempt)) / 1000);
        return res.status(429).json({ error: `Too many login attempts. Please try again in ${resetTime} seconds.` });
    }

    if ((now - attempts.lastAttempt) > limitWindow) {
        attempts.count = 0; // reset
    }

    loginAttempts.set(ip, attempts);
    next();
}

// Serve public login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Admin login API endpoint
app.post('/api/login', loginRateLimiter, (req, res) => {
    const { username, password } = req.body;
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const expectedUsername = process.env.ADMIN_USERNAME || 'TIGER';
    const expectedPassword = process.env.ADMIN_PASSWORD || 'VALTAOIWITHDARKEYE';

    if (username === expectedUsername && password === expectedPassword) {
        const token = crypto.randomBytes(32).toString('hex');
        activeSessions.add(token);
        loginAttempts.delete(ip); // reset attempts on successful login
        res.setHeader('Set-Cookie', `session_token=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400`);
        return res.json({ success: true });
    } else {
        const attempts = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
        attempts.count++;
        attempts.lastAttempt = Date.now();
        loginAttempts.set(ip, attempts);
        return res.status(401).json({ error: 'Invalid username or password' });
    }
});

// Admin logout API endpoint
app.post('/api/admin/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.session_token;
    if (token) {
        activeSessions.delete(token);
    }
    res.setHeader('Set-Cookie', 'session_token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
    res.json({ success: true });
});

// Protect all private pages and API routes
app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/api/login') {
        return next();
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.session_token;

    if (token && activeSessions.has(token)) {
        next();
    } else {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        return res.redirect('/login');
    }
});

// Serve private static files for authenticated users
app.use(express.static(path.join(__dirname, 'private')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Paths to databases
const PROPERTIES_PATH = path.join(__dirname, 'properties.json');
const INQUIRIES_PATH = path.join(__dirname, 'inquiries.json');
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const ACCURACY_PATH = path.join(__dirname, 'accuracy_logs.json');

// Session Store (keyed by WhatsApp JID)
const sessions = new Map();

// Message tracking to prevent loops in self-chats
const botSentMessageIds = new Set();
const botSentMessageQueue = [];
function trackBotMessage(msgId) {
    if (!msgId) return;
    botSentMessageIds.add(msgId);
    botSentMessageQueue.push(msgId);
    if (botSentMessageQueue.length > 500) {
        const oldest = botSentMessageQueue.shift();
        botSentMessageIds.delete(oldest);
    }
}

// WhatsApp Client State
let whatsappStatus = 'disconnected'; // 'disconnected', 'connecting', 'qr', 'ready'
let qrCodeData = '';
let whatsappUser = null;
const serverStartTime = Math.floor(Date.now() / 1000); // Server startup Unix timestamp in seconds

// Initialize Groq client
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY || ''
});

// Database Helpers
async function readJsonFile(filePath, defaultValue) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            try {
                await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
            } catch (wErr) {}
            return defaultValue;
        }
        console.error(`Error reading ${filePath}:`, err);
        return defaultValue;
    }
}


async function writeJsonFile(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error(`Error writing ${filePath}:`, err);
    }
}

const readProperties = () => readJsonFile(PROPERTIES_PATH, []);
const writeProperties = (data) => writeJsonFile(PROPERTIES_PATH, data);
const readInquiries = () => readJsonFile(INQUIRIES_PATH, []);
const writeInquiries = (data) => writeJsonFile(INQUIRIES_PATH, data);
const readSettings = () => readJsonFile(SETTINGS_PATH, { businessName: 'Kalyan Property Consultants', ownerNumber: '919904291097', autoReplyEnabled: false, botPersonality: 'You are the AI Real Estate Advisory Assistant for Kalyan Property Consultants in Surat, Gujarat. Your contact is Jayesh Lakhani (+91 9904291097). Be bilingual, blending Gujarati and English (e.g. "Surat Ma Property Joiye Che?").' });
const writeSettings = (data) => writeJsonFile(SETTINGS_PATH, data);
const readAccuracyLogs = () => readJsonFile(ACCURACY_PATH, []);
const writeAccuracyLogs = (data) => writeJsonFile(ACCURACY_PATH, data);

async function addAccuracyLog(contact, contactName, query, reply) {
    try {
        const logs = await readAccuracyLogs();
        const newLog = {
            id: 'log_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000),
            timestamp: Date.now(),
            contact: contact.replace('@c.us', ''),
            contactName: contactName || 'Unknown Contact',
            query: query,
            reply: reply,
            status: 'pending'
        };
        logs.unshift(newLog);
        if (logs.length > 200) {
            logs.length = 200;
        }
        await writeAccuracyLogs(logs);
    } catch (e) {
        console.error('Error logging accuracy:', e);
    }
}

// Format phone number to JID
function formatJid(phone) {
    if (!phone) return null;
    
    // If it's already a full JID, return as is
    if (phone.endsWith('@c.us') || phone.endsWith('@lid') || phone.endsWith('@g.us')) {
        return phone;
    }
    
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned) {
        return cleaned + '@c.us';
    }
    return null;
}

// Send real estate inquiry status notification to customer via WhatsApp
async function sendInquiryStatusNotification(inquiry, status) {
    if (whatsappStatus !== 'ready') {
        console.log('WhatsApp client is not ready. Cannot send status notification.');
        return;
    }

    const customerJid = formatJid(inquiry.customerPhone);
    if (!customerJid) {
        console.error('Invalid customer phone number:', inquiry.customerPhone);
        return;
    }

    const settings = await readSettings();
    const inqIdShort = inquiry.id.replace('inq_', '');
    const propertyTitle = inquiry.propertyTitle || 'General Properties';

    let messageText = '';
    if (status === 'Contacted') {
        messageText = `📞 *Inquiry Acknowledged - Kalyan Property Consultants*
        
Hi ${inquiry.customerName || 'Client'},
We have successfully processed your inquiry regarding *${propertyTitle}*.

An expert real estate advisor will get in touch with you shortly on this number to assist you with price sheets, brochures, and answers to any questions you have!

Thank you for choosing ${settings.businessName || 'Kalyan Property Consultants'}!`;
    } else if (status === 'Site-Visit Scheduled') {
        messageText = `🏢 *Site Visit Scheduled!*
        
Hi ${inquiry.customerName || 'Client'},
Your site visit for *${propertyTitle}* has been scheduled successfully!

📍 *Property Details/Requirements:* ${inquiry.message || 'Confirmed by coordinator'}
We look forward to showing you the property. Our representative will coordinate with you for smooth access.

Thank you for choosing ${settings.businessName || 'Kalyan Property Consultants'}!`;
    } else if (status === 'Closed Won') {
        messageText = `🎉 *Congratulations on Your Deal!*
        
Hi ${inquiry.customerName || 'Client'},
We are thrilled to have helped you secure your property: *${propertyTitle}*!

Thank you for trusting ${settings.businessName || 'Kalyan Property Consultants'} with your real estate journey. We wish you the very best in your new space!

If you need any further assistance with registration, home loans, or property management, we are always here to help.`;
    } else {
        return; // No automated message for other statuses (e.g. Pending, Cancelled)
    }

    // Try to generate personalized message via AI if key is available
    if (process.env.GROQ_API_KEY) {
        try {
            const systemPrompt = `You are the real estate AI assistant for "${settings.businessName || 'Kalyan Property Consultants'}". 
Personality: ${settings.botPersonality || 'Friendly, polite, professional, and concise.'}`;
            
            let aiPrompt = '';
            if (status === 'Contacted') {
                aiPrompt = `Generate a warm and professional WhatsApp message to client "${inquiry.customerName || 'Client'}" acknowledging their inquiry for property "${propertyTitle}". Tell them an expert advisor will contact them shortly.`;
            } else if (status === 'Site-Visit Scheduled') {
                aiPrompt = `Generate a WhatsApp message to client "${inquiry.customerName || 'Client'}" confirming their scheduled site visit for property "${propertyTitle}". Keep it professional and exciting.`;
            } else if (status === 'Closed Won') {
                aiPrompt = `Generate a congratulatory WhatsApp message to client "${inquiry.customerName || 'Client'}" for successfully closing/purchasing their property "${propertyTitle}" with our assistance.`;
            }

            const chatCompletion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: aiPrompt }
                ],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.7,
                max_tokens: 150
            });

            const aiMessage = chatCompletion.choices[0]?.message?.content?.trim();
            if (aiMessage) {
                messageText = aiMessage;
            }
        } catch (aiErr) {
            console.error('AI message generation failed, using fallback notification:', aiErr);
        }
    }

    try {
        const sentMsg = await client.sendMessage(customerJid, messageText);
        trackBotMessage(sentMsg?.id?._serialized);
        console.log(`Sent inquiry ${status} notification to ${customerJid}`);
    } catch (err) {
        console.error(`Failed to send WhatsApp notification to ${customerJid}:`, err);
    }
}

// Generate system instruction dynamically
async function getSystemInstruction() {
    const settings = await readSettings();
    const activePersonality = settings.activePersonality || 'kalyan';

    if (activePersonality === 'tanmay') {
        return `You are Tanmay's Personal AI Assistant.
Your personality instructions: ${settings.tanmayPrompt || "You are Tanmay's Personal AI Assistant. Tanmay is a Class 11 Commerce student and a beginner coder who builds tech projects by vibe coding ('vibecoder'). Teach and guide him step-by-step. Keep code explanations extremely simple, clear, and beginner-friendly. Help him with Accountancy, Economics, Business Studies, and web development/coding projects."}

GUIDELINES FOR CONVERSATION:
1. Help Tanmay with coding as a beginner: explain things simply, guide him step-by-step, use analogies, and keep instructions very easy to follow. He builds tools and web apps by vibe coding, so prioritize helping him build visual, functioning apps quickly using AI helpers (like HTML, CSS, JavaScript, simple Express servers).
2. Help him understand Class 11 Commerce subjects (Accountancy, Business Studies, Economics) like basic accounting rules, journals, ledgers, microeconomics, and business concepts. Explain them with practical real-world business examples.
3. Brainstorm new tech projects with him and outline the step-by-step execution.
4. Encourage him in his learning journey. Be engaging, structured, and use standard formatting (bullet points, markdown code blocks) where helpful.
5. Reference previous chats and context to analyze his growth and stay on track with his projects.
`;
    } else {
        const properties = await readProperties();
        const formattedProperties = properties.map(p => 
            `- ${p.title} (${p.type}): ${p.priceDisplay} at ${p.locality} [Landmark: ${p.landmark}, Carpet Area: ${p.carpetArea}, Status: ${p.status}, Availability: ${p.available ? 'Available' : 'Sold Out/Leased'}, Photo Link: ${p.image || 'None'}] - ${p.description}`
        ).join('\n');

        return `You are the AI Real Estate Advisory Assistant for "${settings.businessName || 'Kalyan Property Consultants'}".
Your personality: ${settings.kalyanPrompt || settings.botPersonality || 'Friendly, professional, knowledgeable, and helpful. Keep responses concise and use bullet points when presenting options.'}

Here is our current active properties portfolio:
${formattedProperties}

ADVISORY GUIDELINES FOR BUYERS & INVESTORS:
1. Verify GujRERA Registration: For under-construction projects in Gujarat, always advise clients to check and verify the developer's GujRERA registration number.
2. On-Site Inspection: Advise clients to schedule a physical site visit to inspect construction progress, materials, parking allotments, and neighborhood connectivity.
3. Price Breakdown: Advise asking for a complete breakup of costs (base rate, stamp duty, registration charges, GST, maintenance deposits, and parking charges).
4. Title Verification: Advise requesting original property documents, title search report from a local lawyer, and verifying BU (Building Use) permissions.

GUIDELINES FOR CONVERSATION:
1. Greet the customer and help them discover properties from our portfolio based on their requirements (locality like Vesu, City Light, Althan, VIP Road, Adajan, L.P. Savani Road, or Dindoli in Surat; budget; configuration like 2/3/4/5 BHK flats, plot investments, or commercial retail spaces).
2. Answer questions about local connectivity in Surat (e.g., Surat Metro Rail phase development, VIP Road high-street growth, Olpad plot expansion, making Surat a prime real estate destination).
3. If they ask advice or guidelines, share the relevant advisory guidelines from the list above.
4. When they show interest in a property or request a call-back/site visit, you MUST collect:
   - Their Name
   - Inquiry Type: Property Inquiry, Site Visit Request, Advisory Request, or Rental Inquiry
   - Preferred Property/Configuration
   - A short message or their specific requirements (e.g., budget, timeline, schedule for site visit)
5. Once you have collected these details, show a clean summary of the inquiry details. Ask them to confirm if the details are correct.
6. CRITICAL: If and only if the customer explicitly confirms (e.g. says "yes", "confirm", "correct", "please schedule it"), you MUST output the exact tag:
[CREATE_INQUIRY] {
  "customerName": "...",
  "inquiryType": "...",
  "propertyTitle": "...",
  "message": "..."
}
Do not add any other text before, inside, or after this tag. The tag [CREATE_INQUIRY] must be followed immediately by a valid JSON object.
7. PHOTO AND MEDIA REQUESTS: If the client asks to see a photo, image, layout view, or visual preview of a specific property from the portfolio, you MUST output the exact tag:
[SEND_PHOTO] {
  "imageUrl": "...",
  "caption": "..."
}
where "imageUrl" is the exact "Photo Link" value of that property, and "caption" is a brief description of the property layout, locality, and price. Do not output this tag if the property has no Photo Link or if the link is "None". You may write conversational or introductory text BEFORE the [SEND_PHOTO] tag.
`;
    }
}

// REST API Endpoints

// 1. WhatsApp Status
app.get('/api/status', (req, res) => {
    res.json({
        status: whatsappStatus,
        qr: qrCodeData,
        user: whatsappUser
    });
});

app.post('/api/logout', async (req, res) => {
    try {
        console.log('Force unlinking WhatsApp client...');
        whatsappStatus = 'disconnected';
        qrCodeData = '';
        whatsappUser = null;

        try {
            await client.destroy();
        } catch (e) {
            console.log('Client destroy during force logout failed:', e.message);
        }

        // Force delete local session directory
        const sessionPath = path.join(__dirname, '.wwebjs_auth');
        try {
            await fs.rm(sessionPath, { recursive: true, force: true });
            console.log('.wwebjs_auth directory deleted.');
        } catch (rmErr) {
            console.error('Failed to remove .wwebjs_auth folder:', rmErr);
        }

        // Re-initialize client
        setTimeout(() => {
            console.log('Re-initializing WhatsApp client...');
            client.initialize().catch(err => {
                console.error('Failed to re-initialize client after logout:', err);
            });
        }, 1000);

        res.json({ success: true, message: 'WhatsApp session unlinked successfully. A new QR code is being generated.' });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Failed to force unlink WhatsApp client' });
    }
});

// 2. Property Portfolio Management
app.get('/api/properties', async (req, res) => {
    const properties = await readProperties();
    res.json(properties);
});

app.post('/api/properties', async (req, res) => {
    const properties = req.body;
    if (!Array.isArray(properties)) {
        return res.status(400).json({ error: 'Properties must be an array' });
    }
    await writeProperties(properties);
    res.json({ success: true, message: 'Properties portfolio updated successfully' });
});

// 3. Inquiry / Lead Management
app.get('/api/inquiries', async (req, res) => {
    const inquiries = await readInquiries();
    res.json(inquiries);
});

app.post('/api/inquiries/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const allowedStatuses = ['Pending', 'Contacted', 'Site-Visit Scheduled', 'Closed Won', 'Cancelled'];
    
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    const inquiries = await readInquiries();
    const index = inquiries.findIndex(i => i.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Inquiry not found' });
    }

    inquiries[index].status = status;
    await writeInquiries(inquiries);

    if (status === 'Contacted' || status === 'Site-Visit Scheduled' || status === 'Closed Won') {
        sendInquiryStatusNotification(inquiries[index], status).catch(err => {
            console.error(`Failed to send inquiry ${status} notification:`, err);
        });
    }

    res.json({ success: true, inquiry: inquiries[index] });
});

app.post('/api/inquiries/:id/notes', async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;
    
    const inquiries = await readInquiries();
    const index = inquiries.findIndex(i => i.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Inquiry not found' });
    }

    inquiries[index].notes = notes;
    await writeInquiries(inquiries);

    res.json({ success: true, inquiry: inquiries[index] });
});

// 4. Settings Management
app.get('/api/settings', async (req, res) => {
    const settings = await readSettings();
    res.json({
        businessName: settings.businessName || settings.restaurantName || 'Kalyan Property Consultants',
        ownerNumber: settings.ownerNumber,
        botPersonality: settings.botPersonality,
        autoReplyEnabled: settings.autoReplyEnabled === true,
        activePersonality: settings.activePersonality || 'kalyan',
        kalyanPrompt: settings.kalyanPrompt || settings.botPersonality || '',
        tanmayPrompt: settings.tanmayPrompt || '',
        hasApiKey: !!process.env.GROQ_API_KEY
    });
});

app.post('/api/settings', async (req, res) => {
    const { businessName, ownerNumber, botPersonality, autoReplyEnabled, activePersonality, kalyanPrompt, tanmayPrompt, apiKey } = req.body;
    const settings = await readSettings();

    if (businessName !== undefined) settings.businessName = businessName;
    if (ownerNumber !== undefined) settings.ownerNumber = ownerNumber;
    if (autoReplyEnabled !== undefined) settings.autoReplyEnabled = Boolean(autoReplyEnabled);
    
    if (activePersonality !== undefined) settings.activePersonality = activePersonality;
    if (kalyanPrompt !== undefined) settings.kalyanPrompt = kalyanPrompt;
    if (tanmayPrompt !== undefined) settings.tanmayPrompt = tanmayPrompt;

    // Synchronize legacy botPersonality field
    if (settings.activePersonality === 'tanmay') {
        settings.botPersonality = settings.tanmayPrompt || settings.botPersonality;
    } else {
        settings.botPersonality = settings.kalyanPrompt || settings.botPersonality;
    }

    // Direct compatibility fallback if the older dashboard UI updates botPersonality directly
    if (botPersonality !== undefined) {
        settings.botPersonality = botPersonality;
        if (settings.activePersonality === 'tanmay') {
            settings.tanmayPrompt = botPersonality;
        } else {
            settings.kalyanPrompt = botPersonality;
        }
    }

    if (apiKey) {
        process.env.GROQ_API_KEY = apiKey;
        try {
            const envContent = `PORT=${PORT}\nGROQ_API_KEY=${apiKey}\n`;
            await fs.writeFile(path.join(__dirname, '.env'), envContent, 'utf-8');
            groq.apiKey = apiKey;
            console.log('API key updated dynamically');
        } catch (err) {
            console.error('Failed to write .env file:', err);
        }
    }

    await writeSettings(settings);
    res.json({ success: true, settings: settings });
});

// 4.6. Image Upload Management
app.post('/api/upload', async (req, res) => {
    try {
        const { filename, fileData } = req.body;
        if (!filename || !fileData) {
            return res.status(400).json({ error: 'Missing filename or fileData' });
        }
        
        // Strip base64 metadata prefix if exists
        const base64Data = fileData.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Ensure public/uploads directory exists
        const uploadsDir = path.join(__dirname, 'public', 'uploads');
        try {
            await fs.mkdir(uploadsDir, { recursive: true });
        } catch (e) {}
        
        const ext = path.extname(filename) || '.jpg';
        const uniqueFilename = `prop_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}${ext}`;
        const filePath = path.join(uploadsDir, uniqueFilename);
        
        await fs.writeFile(filePath, buffer);
        console.log(`Uploaded file saved to: ${filePath}`);
        
        res.json({ success: true, url: `/uploads/${uniqueFilename}` });
    } catch (err) {
        console.error('File upload error:', err);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// 4.5. Accuracy Board Management
app.get('/api/accuracy', async (req, res) => {
    try {
        const logs = await readAccuracyLogs();
        
        let accurateCount = 0;
        let inaccurateCount = 0;
        
        for (const log of logs) {
            if (log.status === 'accurate') accurateCount++;
            else if (log.status === 'inaccurate') inaccurateCount++;
        }
        
        const totalRated = accurateCount + inaccurateCount;
        const score = totalRated > 0 ? Math.round((accurateCount / totalRated) * 100) : 0;
        
        res.json({
            logs,
            totalRated,
            accurateCount,
            score
        });
    } catch (err) {
        console.error('Error fetching accuracy logs:', err);
        res.status(500).json({ error: 'Failed to fetch accuracy logs' });
    }
});

app.post('/api/accuracy/:logId/rate', async (req, res) => {
    try {
        const { logId } = req.params;
        const { status } = req.body;
        
        if (!['accurate', 'inaccurate', 'pending'].includes(status)) {
            return res.status(400).json({ error: 'Invalid rating status' });
        }
        
        const logs = await readAccuracyLogs();
        const index = logs.findIndex(l => l.id === logId);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Log entry not found' });
        }
        
        logs[index].status = status;
        await writeAccuracyLogs(logs);
        
        res.json({ success: true, log: logs[index] });
    } catch (err) {
        console.error('Error rating bot response:', err);
        res.status(500).json({ error: 'Failed to rate bot response' });
    }
});

// 5. WhatsApp Live Chat & Contact APIs
app.get('/api/whatsapp/chats', async (req, res) => {
    if (whatsappStatus !== 'ready') {
        return res.json({ status: whatsappStatus, chats: [] });
    }
    try {
        const chats = await client.getChats();
        console.log(`[Chats API] Found ${chats.length} chats in total.`);
        const filtered = chats.filter(c => c.id && c.id._serialized !== 'status@broadcast');
        
        const chatList = filtered.map((c) => {
            return {
                id: c.id._serialized,
                name: c.name || c.id.user || 'Unknown Contact',
                number: c.id.user,
                isGroup: c.isGroup,
                unreadCount: c.unreadCount || 0,
                timestamp: c.timestamp ? c.timestamp * 1000 : Date.now(),
                avatar: '',
                lastMessage: c.lastMessage ? {
                    body: c.lastMessage.body || (c.lastMessage.hasMedia ? '[Media / Image]' : ''),
                    timestamp: c.lastMessage.timestamp ? c.lastMessage.timestamp * 1000 : Date.now(),
                    fromMe: c.lastMessage.fromMe
                } : null
            };
        });

        chatList.sort((a, b) => b.timestamp - a.timestamp);

        res.json({ status: 'ready', chats: chatList });
    } catch (err) {
        console.error('Error fetching chats:', err);
        res.status(500).json({ error: 'Failed to fetch WhatsApp chats' });
    }
});

app.get('/api/whatsapp/chats/:chatId/messages', async (req, res) => {
    console.log(`[Messages API] Fetching messages for chatId: ${req.params.chatId}`);
    if (whatsappStatus !== 'ready') {
        return res.status(400).json({ error: 'WhatsApp is not connected' });
    }
    try {
        const { chatId } = req.params;
        const chat = await client.getChatById(chatId);
        const rawMessages = await chat.fetchMessages({ limit: 50 });

        try {
            await chat.sendSeen();
        } catch (e) {}

        const messages = rawMessages.map(m => ({
            id: m.id._serialized,
            body: m.body,
            fromMe: m.fromMe,
            timestamp: m.timestamp ? m.timestamp * 1000 : Date.now(),
            type: m.type,
            hasMedia: m.hasMedia,
            author: m.author || m.from
        }));

        let avatarUrl = '';
        try {
            avatarUrl = await client.getProfilePicUrl(chatId);
        } catch (e) {}

        res.json({
            chat: {
                id: chat.id._serialized,
                name: chat.name || chat.id.user,
                number: chat.id.user,
                isGroup: chat.isGroup,
                avatar: avatarUrl
            },
            messages
        });
    } catch (err) {
        console.error('Error fetching messages for chat:', err);
        res.status(500).json({ error: 'Failed to fetch chat messages' });
    }
});

app.post('/api/whatsapp/chats/:chatId/send', async (req, res) => {
    if (whatsappStatus !== 'ready') {
        return res.status(400).json({ error: 'WhatsApp is not connected' });
    }
    try {
        const { chatId } = req.params;
        const { message } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Message cannot be empty' });
        }

        const sentMsg = await client.sendMessage(chatId, message.trim());
        
        if (sessions.has(chatId)) {
            const session = sessions.get(chatId);
            session.history.push({ role: 'assistant', content: message.trim() });
        }

        res.json({
            success: true,
            message: {
                id: sentMsg.id._serialized,
                body: sentMsg.body,
                fromMe: true,
                timestamp: sentMsg.timestamp ? sentMsg.timestamp * 1000 : Date.now(),
                type: sentMsg.type
            }
        });
    } catch (err) {
        console.error('Error sending WhatsApp message:', err);
        res.status(500).json({ error: 'Failed to send message over WhatsApp' });
    }
});


// Detect Chrome/Chromium or Edge installation paths for reliability across Windows and Linux (including @sparticuz/chromium)
async function getBrowserPath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable'
    ];
    for (const p of paths) {
        if (existsSync(p)) {
            return p;
        }
    }
    try {
        const sparticuzPath = await chromium.executablePath();
        if (sparticuzPath) return sparticuzPath;
    } catch (e) {
        console.warn('Sparticuz chromium path fallback warning:', e.message);
    }
    return null;
}

const browserPath = await getBrowserPath();
const puppeteerOptions = {
    headless: chromium.headless !== undefined ? chromium.headless : true,
    protocolTimeout: 0,
    args: [
        ...(chromium.args || []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    ]
};

if (browserPath) {
    puppeteerOptions.executablePath = browserPath;
    console.log(`Using resolved browser path: ${browserPath}`);
} else {
    console.log('Using default bundled Chromium');
}


// Initialize WhatsApp Client with optimized Puppeteer settings and 90s timeout
const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 90000, // 90 seconds timeout for initialization on slow servers
    puppeteer: puppeteerOptions
});

client.on('qr', async (qr) => {
    whatsappStatus = 'qr';
    try {
        qrCodeData = await qrcode.toDataURL(qr);
        console.log('WhatsApp QR Code generated! Scan in dashboard.');
    } catch (err) {
        console.error('Failed to generate QR data URL:', err);
    }
});

client.on('authenticated', () => {
    console.log('WhatsApp authenticated! Syncing data with phone...');
    whatsappStatus = 'connecting';
});

client.on('ready', () => {
    whatsappStatus = 'ready';
    qrCodeData = '';
    try {
        whatsappUser = client.info || { pushname: 'Kalyan Property Consultants Bot', wid: { user: 'Connected' } };
    } catch (e) {
        whatsappUser = { pushname: 'Kalyan Property Consultants Bot', wid: { user: 'Connected' } };
    }
    console.log('WhatsApp client is ready!');
});



client.on('auth_failure', (msg) => {
    console.error('WhatsApp auth failure:', msg);
    whatsappStatus = 'disconnected';
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp disconnected:', reason);
    whatsappStatus = 'disconnected';
    qrCodeData = '';
    whatsappUser = null;
});

// Helper to send reply with typing simulation to prevent bans
async function sendReplyWithTyping(msg, text) {
    // 1. Initial "reading" delay (simulate human reading time: 2 to 4 seconds)
    const readDelay = 2000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, readDelay));

    // Calculate typing delay based on message length (approx 30ms per character, capped between 2s and 6s)
    const typingDelay = Math.min(Math.max(text.length * 30, 2000), 6000) + (Math.random() * 1000);

    // If it's a LID, skip typing state as the WhatsApp Web internals fail to load chat details for LIDs,
    // but still wait for the typing duration before sending to prevent instant replies.
    if (msg.from && msg.from.includes('@lid')) {
        await new Promise(resolve => setTimeout(resolve, typingDelay));
        const sentMsg = await client.sendMessage(msg.from, text);
        trackBotMessage(sentMsg?.id?._serialized);
        return;
    }
    try {
        const chat = await msg.getChat();
        await chat.sendStateTyping();
        // Wait for simulated typing duration
        await new Promise(resolve => setTimeout(resolve, typingDelay));
        await chat.clearState();
        const sentMsg = await client.sendMessage(msg.from, text);
        trackBotMessage(sentMsg?.id?._serialized);
    } catch (err) {
        console.warn('Typing simulation failed, sending directly after delay:', err.message || err);
        await new Promise(resolve => setTimeout(resolve, typingDelay));
        const sentMsg = await client.sendMessage(msg.from, text);
        trackBotMessage(sentMsg?.id?._serialized);
    }
}

// Process Customer Inquiries via AI
client.on('message', async (msg) => {
    // Avoid loops from bot's own replies
    if (msg.id?._serialized && botSentMessageIds.has(msg.id._serialized)) {
        return;
    }

    // Allow replying to messages sent by ourselves ONLY if it is a self-DM (i.e. sent to our own number)
    const myJid = client.info?.wid?._serialized || whatsappUser?.wid?._serialized;
    const isSelfDM = myJid && (msg.from === myJid);
    if (msg.fromMe && !isSelfDM) return;

    // 2. Avoid responding to group messages, status broadcasts, or newsletters
    if (msg.from.includes('@g.us') || msg.from === 'status@broadcast' || msg.from.includes('@newsletter')) return;

    // 3. Strict Check: AI Auto-Reply must be explicitly enabled in Admin Settings (defaults to true if not set)
    const settings = await readSettings();
    if (settings.autoReplyEnabled === false) {
        console.log(`AI Auto-Reply is OFF. Skipping message from ${msg.from}`);
        return;
    }

    // 4. Strict timestamp check to prevent replying to old/backlogged unread messages
    const rawTime = msg.timestamp || 0;
    const msgTimestampSec = rawTime > 10000000000 ? Math.floor(rawTime / 1000) : rawTime;
    if (msgTimestampSec < serverStartTime - 5) {
        console.log(`Skipping backlogged message from ${msg.from} (sent before server boot)`);
        return;
    }

    const from = msg.from;
    const body = msg.body;

    console.log(`Received message from ${from}: ${body}`);

    // 5. Silent check for GROQ_API_KEY (DO NOT send unprompted text to contact!)
    if (!process.env.GROQ_API_KEY) {
        console.log(`GROQ_API_KEY is missing. Skipping auto-reply to ${from}`);
        return;
    }

    // Get or initialize session
    if (!sessions.has(from)) {
        sessions.set(from, { history: [] });
    }
    const session = sessions.get(from);

    // Fetch contact push name for evaluation log
    let contactName = 'Unknown Contact';
    try {
        const contactObj = await msg.getContact();
        contactName = contactObj.name || contactObj.pushname || contactObj.number || 'Unknown Contact';
    } catch (e) {}

    // Add user message to history
    session.history.push({ role: 'user', content: body });

    // Keep history length reasonable
    if (session.history.length > 20) {
        session.history = session.history.slice(-20);
    }

    try {
        const systemInstruction = await getSystemInstruction();
        const settings = await readSettings();

        // Call Groq API
        const messages = [
            { role: 'system', content: systemInstruction },
            ...session.history
        ];

        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2 // low temp for accurate details
        });

        const replyContent = chatCompletion.choices[0]?.message?.content || '';

        // Check if the AI wants to send a photo
        if (replyContent.includes('[SEND_PHOTO]')) {
            const parts = replyContent.split('[SEND_PHOTO]');
            const textReply = parts[0].trim();
            const jsonText = parts[1].trim();

            if (textReply) {
                await sendReplyWithTyping(msg, textReply);
                session.history.push({ role: 'assistant', content: textReply });
                await addAccuracyLog(from, contactName, body, textReply);
            }

            try {
                const photoData = JSON.parse(jsonText);
                if (photoData.imageUrl && photoData.imageUrl !== 'None') {
                    const media = await MessageMedia.fromUrl(photoData.imageUrl, { unsafeMime: true });
                    const sentMsg = await client.sendMessage(from, media, { caption: photoData.caption || '' });
                    trackBotMessage(sentMsg?.id?._serialized);
                    session.history.push({ role: 'assistant', content: `[Sent photo: ${photoData.imageUrl} with caption: ${photoData.caption || ''}]` });
                    await addAccuracyLog(from, contactName, body, `[Sent photo: ${photoData.imageUrl}] ${photoData.caption || ''}`);
                }
            } catch (mediaErr) {
                console.error('Failed to load/send media from URL:', mediaErr);
                // Fallback to sending text link
                try {
                    const photoData = JSON.parse(jsonText);
                    await sendReplyWithTyping(msg, `📷 Here is the photo of the property:\n${photoData.imageUrl}\n\n${photoData.caption || ''}`);
                    session.history.push({ role: 'assistant', content: `[Sent text photo link: ${photoData.imageUrl}]` });
                    await addAccuracyLog(from, contactName, body, `📷 Here is the photo of the property:\n${photoData.imageUrl}\n\n${photoData.caption || ''}`);
                } catch (parseErr) {
                    console.error('Failed fallback parse:', parseErr);
                }
            }
        } else if (replyContent.includes('[CREATE_INQUIRY]')) {
            const parts = replyContent.split('[CREATE_INQUIRY]');
            const jsonText = parts[1].trim();

            try {
                const inquiryData = JSON.parse(jsonText);
                
                // Save the inquiry to DB
                const inquiries = await readInquiries();
                const newInquiry = {
                    id: 'inq_' + Math.floor(1000 + Math.random() * 9000),
                    date: new Date().toISOString(),
                    status: 'Pending',
                    customerPhone: from.replace('@c.us', ''),
                    customerName: inquiryData.customerName,
                    inquiryType: inquiryData.inquiryType,
                    propertyTitle: inquiryData.propertyTitle,
                    message: inquiryData.message,
                    notes: ''
                };

                inquiries.unshift(newInquiry); // Add to the top
                await writeInquiries(inquiries);

                // Send confirmation to Customer
                const confirmationMsg = `🎉 *Inquiry Registered!*

Thank you, *${newInquiry.customerName}*. Your request has been logged with Kalyan Property Consultants.
*Inquiry ID:* #${newInquiry.id.replace('inq_', '')}
*Interest Type:* ${newInquiry.inquiryType}
*Property:* ${newInquiry.propertyTitle}

An advisor will connect with you shortly to assist with brochures, prices, and site visits.`;

                await sendReplyWithTyping(msg, confirmationMsg);
                await addAccuracyLog(from, contactName, body, confirmationMsg);

                // Notify Owner (if configured)
                if (settings.ownerNumber) {
                    const ownerJid = formatJid(settings.ownerNumber);
                    if (ownerJid) {
                        const ownerMsg = `🏢 *New Real Estate Lead Captured!*

*Inquiry ID:* #${newInquiry.id.replace('inq_', '')}
*Client:* ${newInquiry.customerName} (${newInquiry.customerPhone})
*Type:* ${newInquiry.inquiryType}
*Property:* ${newInquiry.propertyTitle}
*Message:* ${newInquiry.message}

View on Dashboard: http://localhost:${PORT}`;
                        const sentMsg = await client.sendMessage(ownerJid, ownerMsg);
                        trackBotMessage(sentMsg?.id?._serialized);
                    }
                }

                // Clear/reset session
                sessions.delete(from);
                console.log(`Inquiry ${newInquiry.id} logged successfully! Session cleared.`);

            } catch (jsonErr) {
                console.error('Failed to parse inquiry JSON:', jsonErr, 'JSON Text:', jsonText);
                await sendReplyWithTyping(msg, "I'm sorry, I encountered a technical issue recording your details. Let's confirm again.");
                session.history.push({ role: 'assistant', content: "I apologize, let's confirm your details once more. Please check if the details are correct." });
            }
        } else {
            // Normal conversation reply
            await sendReplyWithTyping(msg, replyContent);
            // Save assistant reply to history
            session.history.push({ role: 'assistant', content: replyContent });
            await addAccuracyLog(from, contactName, body, replyContent);
        }

    } catch (apiErr) {
        console.error('Groq API Error:', apiErr);
        await sendReplyWithTyping(msg, "I'm sorry, I'm having trouble responding right now. Please try again in a few moments.");
    }
});

// Clean exit handlers to shut down Chrome and release locks
process.on('SIGINT', async () => {
    console.log('SIGINT received. Cleaning up browser...');
    try {
        await client.destroy();
    } catch (e) {}
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Cleaning up browser...');
    try {
        await client.destroy();
    } catch (e) {}
    process.exit(0);
});

// Start Express Server immediately so Render health checks succeed
app.listen(PORT, () => {
    console.log(`Server running at port ${PORT}`);
    
    // Boot the WhatsApp client asynchronously in the background
    console.log('Initializing WhatsApp client in the background...');
    client.initialize().catch(err => {
        console.error('Failed to initialize WhatsApp client:', err);
    });
});

