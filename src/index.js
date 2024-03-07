require('dotenv').config({ path: '../.env' });

const nodemailer = require('nodemailer');
const hbs = require('nodemailer-express-handlebars');
let Parser = require('rss-parser');
let parser = new Parser();
const puppeteer = require('puppeteer');
let OpenAI = require('openai');

const openai = new OpenAI({
	apiKey: process.env.CHAT_GPT_API_KEY,
});

async function run() {
	const feeds = [
		{
			name: 'BBC Football',
			url: 'http://newsrss.bbc.co.uk/rss/sportonline_uk_edition/football/rss.xml',
			type: 'BBC',
			articleCount: 5,
		},
		{
			name: 'BBC News UK',
			url: 'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/front_page/rss.xml',
			type: 'BBC',
			articleCount: 5,
		},
		{
			name: 'Sky Sports News',
			url: 'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/front_page/rss.xml',
			type: 'SKY',
			articleCount: 1,
		},
	];

	const browser = await puppeteer.launch();

	const promises = [];

	for (const feed of feeds) {
		switch (feed.type) {
			case 'BBC':
				promises.push(parseBBCFeed(feed, browser));
				break;
			default:
				console.error(`No parser for ${feed.type}`);
		}
	}

	const results = await Promise.all(promises);

	await sendEmail(results);

	await browser.close();
}

async function parseBBCFeed(feed, browser) {
	let parsedFeed = await parser.parseURL(feed.url);

	const promises = [];

	for (const item of parsedFeed.items.slice(0, feed.articleCount)) {
		const page = await browser.newPage();
		await page.goto(item.link, { waitUntil: 'networkidle2' });

		const article = await page.evaluate(() => {
			return [...document.querySelectorAll('article')][0].textContent;
		});

		promises.push(summarise(article, item));
	}

	const results = await Promise.all(promises);

	return { feedName: feed.name, articles: results };
}

async function summarise(content, item) {
	const completion = await openai.chat.completions.create({
		messages: [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: `Summarise this: ${content.substring(0, 16300)}` },
		],
		model: 'gpt-3.5-turbo',
	});

	return {
		link: item.link,
		title: item.title,
		content: completion.choices[0].message.content,
	};
}

async function sendEmail(results) {
	const transporter = nodemailer.createTransport({
		service: 'gmail',
		auth: {
			user: process.env.GMAIL_EMAIL,
			pass: process.env.GMAIL_PASSWORD,
		},
	});

	const hbsOptions = {
		viewEngine: {
			defaultLayout: false,
		},
		viewPath: 'templates',
	};

	transporter.use('compile', hbs(hbsOptions));

	const mailOptions = {
		from: process.env.GMAIL_EMAIL,
		to: process.env.GMAIL_EMAIL,
		subject: 'News Blast',
		template: 'news_blast',
		context: { blocks: results },
	};

	await transporter.sendMail(mailOptions);

	console.log('Email Sent!');
}

run();
