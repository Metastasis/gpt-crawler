// For more information, see https://crawlee.dev/
import { PlaywrightCrawler } from "crawlee";
import { readFile, writeFile } from "fs/promises";
import { glob } from "glob";
import { config } from "../config.js";
import { Page } from "playwright";


/*
Что парсим?
- Количество карточек
- Компания или бренд
- Цена
- Оценка товара
- Количество оценок товара
* */
type Company = {
  name: string,
  type: 'ip' | 'ooo' | 'zao' | 'ao' | 'other' | null,
  // company from breadcrumbs or from sidebar can be different
  // company from sidebar can be used for marketing purposes
  // and from breadcrumbs is more reliable
  parsedFrom: 'fromBreadcrumbs' | 'fromSidebar',
  url: string,
};
type SizeValue = {
  value: number,
  ci: 'cm'
} | {
  value: string,
  ci: 'unknown'
};
type Size = {
  length?: SizeValue,
  width?: SizeValue,
  height?: SizeValue,
};
type CategoryTrait = {
  // top category, e.g. "Женщинам"
  category: string,
  // subcategory, e.g. "Блузки и рубашки"
  subcategory: string,
  // goods type, e.g. "Блузка-боди"
  goodsCategory: string,
}
type WildberriesCategoryPageResult = CategoryTrait & {
  total: number,
};
type WildberriesProductPageResult = {
  title: string,
  // url: string,
  price: number,
  rating: number | null,
  ratingCount: number | null,
  company: Company | null,
  sizes: Size | null,
};

const wildberriesSelectors = {
  categoryTitle: "h1.catalog-title",
  breadcrumbs: "ul.breadcrumbs__list",
  categoryFilters: ".dropdown-filter",
  categoryFilterOpened: ".dropdown-filter .selected",
  productLinks: ".product-card__link",
} as const;
const wildberriesProductSelectors = {
  title: ".product-page__header > h1",
  company: ".breadcrumbs__list li:last-child",
  price: ".product-page__aside-container .price-block__final-price",
  rating: ".product-page__common-info .product-review__rating",
  ratingCount: ".product-page__common-info .product-review__count-review",
  productParams: ".product-params__table",
};
const labels = {
  product: 'PRODUCT',
} as const;

async function getPageHtml(page: Page): Promise<WildberriesCategoryPageResult> {
  const breadcrumbsRaw = await page.locator(wildberriesSelectors.breadcrumbs).innerText();
  const breadcrumbs = breadcrumbsRaw.split("\n").map((item) => item.trim().toLowerCase()).filter((item) => {
    return item.length > 0 && item !== "главная";
  });
  const [category, subcategory] = breadcrumbs;
  const categoryFilters = await page.locator(wildberriesSelectors.categoryFilters).filter({hasText: "Категория"});
  const categoryButton = await categoryFilters.locator("button");
  await categoryButton.click();
  const categoryFilterOpened = await page.locator(wildberriesSelectors.categoryFilterOpened).last().textContent() || '';
  const categoryWithTotal = categoryFilterOpened.toLowerCase().trim();
  const goodsCategory = categoryWithTotal.replace(/[^а-яА-Я\-]/g, "");
  const total = parseInt(categoryWithTotal.replace(/[^\d]/g, ''), 10);
  return {
    total,
    category,
    subcategory,
    goodsCategory,
  };
}

async function scrapProduct(page: Page): Promise<WildberriesProductPageResult> {
  const titleRaw = await page.locator(wildberriesProductSelectors.title).textContent();
  if (!titleRaw) {
    throw new Error(`Title not found on ${page.url()}`);
  }
  const title = titleRaw.trim().toLowerCase();
  const priceRaw = await page.locator(wildberriesProductSelectors.price).textContent();
  if (!priceRaw) {
    throw new Error(`Price not found on ${page.url()}`);
  }
  const price = parseFloat(priceRaw.replace(/[^\d]/g, ''));
  const companyLocator = await page.locator(wildberriesProductSelectors.company);
  const companyTitleRaw = await companyLocator.textContent();
  if (!companyTitleRaw) {
    throw new Error(`Company title not found on ${page.url()}`);
  }
  const companyTitle = companyTitleRaw.trim().toLowerCase();
  const companyLinkRaw = await companyLocator.locator('a').getAttribute('href');
  if (!companyLinkRaw) {
    throw new Error(`Company link not found on ${page.url()}`);
  }
  const baseUrl = new URL(page.url()).origin;
  const companyLink = `${baseUrl}${companyLinkRaw}`;
  const company: Company = {
    name: companyTitle,
    type: null,
    url: companyLink,
    parsedFrom: 'fromBreadcrumbs',
  };
  const ratingRaw = await page.locator(wildberriesProductSelectors.rating).textContent();
  if (!ratingRaw) {
    throw new Error(`Rating not found on ${page.url()}`);
  }
  // There may be no ratings.
  // If there are none, then the text “No ratings” will appear.
  const rating = parseFloat(ratingRaw.replace(/[^\d]/g, '')) || null;
  const ratingCountRaw = await page.locator(wildberriesProductSelectors.ratingCount).textContent();
  if (!ratingCountRaw) {
    throw new Error(`Rating count not found on ${page.url()}`);
  }
  const ratingCount = parseInt(ratingCountRaw.replace(/[^\d]/g, ''), 10) || null;
  const productTables = await page.locator(wildberriesProductSelectors.productParams).filter({hasText: "Габариты"});
  const table = await productTables.count() ? await productTables.locator('tbody') : null;
  const productParamsRaw = table ? await table.evaluate((tbody) => {
    const results: Array<{param: string, value: string}> = [];
    for (const el of tbody.children) {
      if (!el.firstChild || !el.lastChild) {
        continue;
      }
      const th = el.firstChild.textContent;
      const td = el.lastChild.textContent;
      if (!th || !td) {
        continue;
      }
      results.push({param: th.trim().toLowerCase(), value: td.trim().toLowerCase()});
    }
    return results;
  }) : [];
  const sizes = productParamsRaw.length ? productParamsRaw.reduce((acc, item) => {
    if (item.param.includes('длина')) {
      acc.length = item.value.endsWith('см')
        ? {value: parseInt(item.value, 10), ci: 'cm'}
        : {value: item.value, ci: 'unknown'};
    } else if (item.param.includes('высота')) {
      acc.height = item.value.endsWith('см')
        ? {value: parseInt(item.value, 10), ci: 'cm'}
        : {value: item.value, ci: 'unknown'};
    } else if (item.param.includes('ширина')) {
      acc.width = item.value.endsWith('см')
        ? {value: parseInt(item.value, 10), ci: 'cm'}
        : {value: item.value, ci: 'unknown'};
    }
    return acc;
  }, {} as Size) : null;
  return {
    title,
    price,
    company,
    rating,
    ratingCount,
    sizes
  };
}

if (process.env.NO_CRAWL !== "true") {
  // PlaywrightCrawler crawls the web using a headless
  // browser controlled by the Playwright library.
  const crawler = new PlaywrightCrawler({
    // Use the requestHandler to process each of the crawled pages.
    async requestHandler({ request, page, enqueueLinks, log, pushData }) {
      if (config.cookie) {
        // Set the cookie for the specific URL
        const cookie = {
          name: config.cookie.name,
          value: config.cookie.value,
          url: request.loadedUrl,
        };
        await page.context().addCookies([cookie]);
      }

      if (request.label === labels.product) {
        log.info(`Crawling ${request.loadedUrl}, label is ${request.label}...`);
        await page.waitForSelector(wildberriesProductSelectors.title, {
          timeout: config.waitForSelectorTimeout ?? 1000,
        });
        const category: CategoryTrait = {
          category: request.userData.category,
          subcategory: request.userData.subcategory,
          goodsCategory: request.userData.goodsCategory,
        };
        const data: WildberriesProductPageResult = await scrapProduct(page);
        await pushData({ title: data.title, url: request.loadedUrl, data, category });
        return;
      }

      const titleRaw = await page.locator(wildberriesSelectors.categoryTitle).textContent();
      const title = titleRaw ? titleRaw.trim().toLowerCase() : null;

      log.info(`Crawling ${request.loadedUrl}...`);

      await page.waitForSelector(config.selector, {
        timeout: config.waitForSelectorTimeout ?? 1000,
      });

      const data: WildberriesCategoryPageResult = await getPageHtml(page);

      // Save results as JSON to ./storage/datasets/default
      await pushData({ title, url: request.loadedUrl, data });

      if (config.onVisitPage) {
        await config.onVisitPage({ page, pushData });
      }

      // Extract links from the current page
      // and add them to the crawling queue.
      await enqueueLinks({
        selector: wildberriesSelectors.productLinks,
        label: labels.product,
        userData: {
          category: data.category,
          subcategory: data.subcategory,
          goodsCategory: data.goodsCategory,
        }
      });
      // await enqueueLinks({
      //   globs: [config.match],
      // });
    },
    // Comment this option to scrape the full website.
    maxRequestsPerCrawl: config.maxPagesToCrawl,
    // Uncomment this option to see the browser window.
    // headless: false,
  });

  // Add first URL to the queue and start the crawl.
  await crawler.run([config.url]);
}

const jsonFiles = await glob("storage/datasets/default/*.json", {
  absolute: true,
});

const results = [];
for (const file of jsonFiles) {
  const data = JSON.parse(await readFile(file, "utf-8"));
  results.push(data);
}

await writeFile(config.outputFileName, JSON.stringify(results, null, 2));
