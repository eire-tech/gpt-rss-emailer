let Parser = require('rss-parser');
let parser = new Parser();
const puppeteer = require('puppeteer');
let OpenAI = require('openai');
const { default: config } = require('../config');

const openai = new OpenAI({
	apiKey: config.chatGPTApiKey,
});

async function run() {
	const feeds = [
		{
			name: 'BBC Football',
			url: 'http://newsrss.bbc.co.uk/rss/sportonline_uk_edition/football/rss.xml',
			type: 'BBC',
			articleCount: 1,
		},
		{
			name: 'BBC News UK',
			url: 'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/front_page/rss.xml',
			type: 'BBC',
			articleCount: 1,
		},
		{
			name: 'Sky Sports News',
			url: 'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/front_page/rss.xml',
			type: 'SKY',
			articleCount: 1,
		},
	];

	const browser = await puppeteer.launch();
	const page = await browser.newPage();

	for (const feed of feeds) {
		switch (feed.type) {
			case 'BBC':
				await parseBBCFeed(feed, page);
				break;
			default:
				console.error(`No parser for ${feed.type}`);
		}
	}

	await browser.close();
}

async function parseBBCFeed(feed, page) {
	console.log(feed.name, '\n\n');
	let parsedFeed = await parser.parseURL(feed.url);

	for (const item of parsedFeed.items.slice(0, feed.articleCount)) {
		console.log(item.link);
		console.log(item.title);

		await page.goto(item.link, { waitUntil: 'networkidle2' });

		const article = await page.evaluate(() => {
			return [...document.querySelectorAll('article')][0].textContent;
		});

		await summarise(article);
	}
}

async function summarise(content) {
	console.log('Summarising...');
	const completion = await openai.chat.completions.create({
		messages: [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: `Summarise this: ${content.substring(0, 16300)}` },
		],
		model: 'gpt-3.5-turbo',
	});

	console.log(completion.choices[0].message.content, '\n\n\n\n');
}

run();
