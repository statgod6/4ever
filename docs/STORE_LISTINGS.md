# 4Ever — Store Listing Copy (Draft)

Ready-to-paste copy for App Store Connect and Google Play Console. Lengths
are already sized to the platform limits.

---

## App Store Connect (Apple)

### App name (30 chars)
`4Ever — AI Life OS`

### Subtitle (30 chars)
`Think. Journal. Grow.`

### Promotional text (170 chars — editable without new build)
`Your private AI-powered life OS. Analyze any thought through multiple personas, journal with continuity, build a knowledge base, and nurture the people in your Circle.`

### Keywords (100 chars, comma-separated, no spaces after commas)
`ai,journal,thoughts,life,coach,personas,knowledge,productivity,mindfulness,self,growth,reflection`

### Description (4000 chars)

```
4Ever is your private, AI-powered life OS — a single place to think, journal, plan, and grow.

Submit any thought — a decision you're wrestling with, a creative idea, a concern you can't shake — and get responses from multiple AI personas you've chosen. Each persona brings its own perspective: the Strategist, the Therapist, the Devil's Advocate, the Mentor, and many more. Instead of a single generic answer, you see your thought examined from every angle.

But 4Ever is more than multi-perspective thinking. It's a complete life OS:

THINK & JOURNAL
• Capture thoughts with voice or text
• Multi-persona analysis shows you what you might be missing
• Every entry is searchable, connected, and remembered forever
• AI helps you notice patterns you wouldn't see on your own

CORE CHAT — YOUR AI COMPANION
• A single AI that knows your journal, your circle, your goals, your calendar
• Ask "how am I doing this week?" and get a real answer
• Schedule reminders, add contacts, look things up — all in natural language
• 45+ tools for web search, math, weather, and more

CIRCLE — YOUR INNER PEOPLE
• Add the people who matter most
• Track relationship health, important dates, and shared memories
• Optional: connect with other 4Ever users for private, AI-mediated conversations
• The AI helps you notice when a friendship needs attention

KNOWLEDGE WORKER (Premium)
• Upload documents, spreadsheets, and notes
• Ask questions across everything you've ever saved
• Generate reports, summaries, and visualizations with Python
• Your personal research assistant that never forgets

LIFE DIMENSIONS
• Track the 8 areas of your life on the Life Wheel
• Set rituals and watch habits compound
• Log events, moods, and energy — spot patterns over months
• Get weekly reflections tailored to your life

PRIVACY BY DESIGN
• Your data is yours. Phone-number auth — no social login required.
• One-tap data export (full JSON) and account deletion at any time
• AI prompts are never used to train foundation models
• Full transparency on what we send where (Privacy Policy in the app)

SIGN IN WITH APPLE SUPPORTED
• Option to sign in with Apple for faster onboarding on iOS

FREE & PREMIUM
• Free tier includes the full Core Chat, Journal, and Circle with generous monthly quotas
• Premium unlocks the Knowledge Worker agent and higher LLM quotas
• Subscribe through the App Store — cancel anytime

4Ever is for anyone who thinks for a living, wrestles with big decisions, or wants their personal growth to compound. It's private, fast, and genuinely useful from day one.

Not a medical, legal, or financial advisor. Not a replacement for human therapy. In a crisis, contact your local emergency services.
```

### What's New (4000 chars — per release)

```
First release of 4Ever.

• Multi-persona thought analysis
• Core Chat with 45+ tools
• Relationship Circle with private AI messaging
• Life Wheel and daily rituals
• Knowledge Worker (Premium)
• Sign in with Apple
• Full data export and account deletion
```

### App Review Information

- **Sign-in required?** Yes
- **Demo account phone:** `+91-XXXXXXXXXX` (create a real working number you control; Apple reviewers will OTP through it)
- **Demo account notes:**
  ```
  4Ever uses SMS OTP authentication. To test:
  1. Tap "Send Verification Code"
  2. Use the demo phone number above; Twilio will deliver the OTP
  3. If SMS delivery fails in your region, use Sign in with Apple instead
  4. After login, the Quick Tour shows the main features

  The AI is intentionally opinionated — it's designed to give real perspectives,
  not hedge. It is not medical, legal, or financial advice, and the Privacy & Data
  screen (More tab) lets reviewers test data export and account deletion.

  Subscription: StoreKit sandbox is configured for the Premium tier. The Free
  tier has enough quota for review.
  ```

### Age Rating answers

- Unrestricted Web Access: **No** (Tavily search is sandboxed, no raw web browser)
- Gambling: No
- Contests: No
- Infrequent/Mild Mature/Suggestive Themes: **Yes** (AI may discuss emotional topics with adult users)
- Infrequent/Mild Profanity or Crude Humor: **Yes** (user-generated content in journals)
- Infrequent/Mild Alcohol, Tobacco, or Drug Use: No
- User-Generated Content: **Yes** (users can create thoughts, upload documents)
- Age: **12+**

### Categories
- Primary: **Productivity**
- Secondary: **Lifestyle**

### Support URL
`https://4ever.app/support`

### Marketing URL
`https://4ever.app`

### Privacy Policy URL
`https://4ever.app/privacy`

### License Agreement
Use Apple's standard EULA (link to `https://4ever.app/terms` in App Review Notes).

---

## Google Play Console

### App name (30 chars)
`4Ever — AI Life OS`

### Short description (80 chars)
`Private AI life OS: think, journal, plan, and grow with multi-persona analysis.`

### Full description (4000 chars)
Same copy as App Store Description above.

### Category
- Primary: **Productivity**
- Tags: `ai_assistant`, `journal`, `personal_productivity`

### Content rating (IARC questionnaire answers)
- Violence: **None**
- Sexual content: **None**
- Profanity: **Mild** (user content)
- Drugs/alcohol/tobacco: **None**
- Gambling: **None**
- User interaction: **Yes** (Circle messaging with consent model)
- Shares location: **No**
- Digital purchases: **Yes** (subscription)
- User-generated content: **Yes**

Expected rating: **PEGI 12 / ESRB Teen / IARC 12+**

### Data Safety form (source of truth: `docs/PRIVACY.md` §2)

**Data collected:**

| Type | Purpose | Shared? | Optional? |
|---|---|---|---|
| Phone number | Account management, SMS OTP | Shared with Twilio | No |
| Email (SIWA only) | Account management | Shared with Apple | Yes |
| Name | Account management, personalization | No | No |
| Photos (profile) | Personalization | Stored on our servers | Yes |
| Voice recordings | App functionality | Shared with OpenRouter for transcription; deleted after transcript | Yes |
| User-generated content (journals, messages, documents) | App functionality, AI responses | Shared with OpenRouter (prompt content only) | No |
| Contacts | App functionality (Circle only, hashed) | No | Yes |
| Crash logs | App functionality | Shared with Sentry | No |
| App interactions | Analytics, quota enforcement | No | No |
| Device identifiers | Analytics, fraud prevention | No | No |

**Security practices:**
- ✅ Data is encrypted in transit
- ✅ Data is encrypted at rest
- ✅ Users can request data deletion (in-app under Privacy & Data)
- ✅ Independent security review: **Pending** (plan to commission one post-launch)
- ✅ Follows Play Families Policy: **Not applicable** (app is 12+)

### Store listing assets required

| Asset | Size | Count | Status |
|---|---|---|---|
| App icon | 512×512 PNG | 1 | ⬜ TODO |
| Feature graphic | 1024×500 PNG | 1 | ⬜ TODO |
| Phone screenshots | 1080×1920 or similar portrait | Min 2, max 8 | ⬜ TODO |
| 7" tablet screenshots | 1200×1920 | Optional, recommended 2 | ⬜ TODO |
| 10" tablet screenshots | 1920×1200 or similar | Optional, recommended 2 | ⬜ TODO |
| Promo video | YouTube link, 30s | Optional, strongly recommended | ⬜ TODO |

**Suggested screenshot sequence** (for both stores, 5 screenshots is the sweet spot):

1. **Hero** — Multi-persona thought analysis view (shows 3 personas responding to one thought)
2. **Core Chat** — Natural language with a scheduled reminder being created
3. **Circle** — Relationship health dashboard with one connection expanded
4. **Knowledge Worker** — Document chat with citation
5. **Privacy** — The Export My Data + Delete Account screen (reassures reviewers)

---

## Social / marketing landing copy

### One-liner
"Your private AI-powered life OS. Think, journal, and grow — with perspectives that matter."

### Meta description (160 chars, for `4ever.app` landing page)
`4Ever is a private AI life OS that helps you journal with continuity, analyze thoughts through multiple personas, and nurture the people who matter.`

### Twitter/X card
```
4Ever — your private AI life OS.

• Multi-persona thought analysis
• Memory that actually remembers
• Knowledge Worker agent
• Your data, your control

Launching on iOS and Android. Private beta testers welcome.
→ 4ever.app
```
