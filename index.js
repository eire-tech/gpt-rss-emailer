require('dotenv').config();

const nodemailer = require('nodemailer');
const hbs = require('nodemailer-express-handlebars');
let Parser = require('rss-parser');
let parser = new Parser();
let OpenAI = require('openai');
const axios = require('axios');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const { backOff } = require('exponential-backoff');

const openai = new OpenAI({
	apiKey: process.env.CHAT_GPT_API_KEY,
});

const handler = async () => {
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
	];

	const before = Date.now();

	const promises = [];

	for (const feed of feeds) {
		switch (feed.type) {
			case 'BBC':
				promises.push(parseBBCFeed(feed));
				break;
			default:
				console.error(`No parser for ${feed.type}`);
		}
	}

	const results = await Promise.all(promises);

	await sendEmail(results);

	const after = Date.now();
	console.log(`Ran in: ${(after - before) / 1000}secs`);
};

module.exports = { handler };

async function parseBBCFeed(feed) {
	let parsedFeed = await parser.parseURL(feed.url);

	const promises = [];

	for (const item of parsedFeed.items.slice(0, feed.articleCount)) {
		const response = await axios.get(item.link);
		const dom = new JSDOM(response.data);
		const article = [...dom.window.document.querySelectorAll('article')][0].textContent;

		promises.push(summarise(article, item));
	}

	const results = await Promise.all(promises);

	return { feedName: feed.name, articles: results };
}

async function summarise(content, item) {
	try {
		const response = await backOff(
			async () => {
				return await openai.chat.completions.create({
					messages: [
						{ role: 'user', content: `Summarise this: ${content.substring(0, 16300)}` },
					],
					model: 'gpt-3.5-turbo',
				});
			},
			{
				delayFirstAttempt: false,
				retry: async (e) => {
					console.error(e.error.message);
					console.error(`Delaying for: ${e.headers['retry-after-ms']}`);
					await delay(parseInt(e.headers['retry-after-ms']) + 2000);
					return true;
				},
			}
		);

		return {
			link: item.link,
			title: item.title,
			content: response.choices[0].message.content,
		};
	} catch (error) {
		console.error('Backed off', error);
	}
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

handler();

const delay = (delayInms) => {
	return new Promise((resolve) => setTimeout(resolve, delayInms));
};
