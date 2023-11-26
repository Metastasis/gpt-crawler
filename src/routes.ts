import { createPlaywrightRouter, Dataset } from "crawlee";
import {config} from "../config";
import {Page} from 'playwright';


// createPlaywrightRouter() is only a helper to get better
// intellisense and typings. You can use Router.create() too.
export const router = createPlaywrightRouter();

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
const wildberriesMainPageSelectors = {
  menuButton: '.nav-element__burger',
  menuList: '.menu-burger__main-list',
};
const wildberriesCategoryPageSelectors = {
  categoriesLinks: '.menu-catalog__list-2',
};
const labels = {
  product: 'product',
  categoryPage: 'categoryPage',
  subCategoryPage: 'subCategoryPage',
} as const;

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

router.addHandler(labels.product, async ({ request, page, log, pushData }) => {
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
});

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

router.addHandler(labels.subCategoryPage, async ({ request, page, log, pushData, enqueueLinks }) => {
  const titleRaw = await page.locator(wildberriesSelectors.categoryTitle).textContent();
  const title = titleRaw ? titleRaw.trim().toLowerCase() : null;

  log.info(`Crawling ${request.loadedUrl}...`);

  await page.waitForSelector(config.selector, {
    timeout: config.waitForSelectorTimeout ?? 1000,
  });

  const data: WildberriesCategoryPageResult = await getPageHtml(page);

  // Save results as JSON to ./storage/datasets/default
  await pushData({ title, url: request.loadedUrl, data });
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
});
type CategoryUserData = {
  parentLinks: Record<string, {href: string, title: string}>
};
router.addHandler(labels.categoryPage, async ({ request, page, log, pushData }) => {
  log.info(`Crawling ${page.url()}...`);
  const data: CategoryUserData = request.userData as any;
  const parentLinks = data.parentLinks;
  const currentUrl = new URL(page.url());
  const currentLink = parentLinks[currentUrl.href];
  if (!currentLink) {
    throw new Error(`Current link not found in parent links: ${currentUrl}`);
  }
  await page.waitForSelector(config.selector, {
    timeout: config.waitForSelectorTimeout ?? 1000,
  });
  const categoriesLinks = await page.locator(wildberriesCategoryPageSelectors.categoriesLinks);
  const links = await categoriesLinks.evaluate((el) => {
    const urls: Array<{href: string, title: string}> = [];
    for (const node of el.children) {
      const link = node.querySelector("a");
      if (link && link.href) {
        urls.push({href: (new URL(link.href)).href, title: link.innerText.trim()});
      }
    }
    return urls;
  });
  await pushData({ parent: currentLink, children: links });
  // await enqueueLinks({
  //   urls: links.map((item) => item.href),
  //   userData: {
  //     links: { parent: currentLink, children: links }
  //   }
  // });
});

router.addDefaultHandler(async ({page, enqueueLinks}) => {
  await page.waitForSelector(config.selector, {
    timeout: config.waitForSelectorTimeout ?? 1000,
  });
  const menuButton = await page.locator(wildberriesMainPageSelectors.menuButton);
  await menuButton.click();
  const menuList = await page.locator(wildberriesMainPageSelectors.menuList);
  const links = await menuList.evaluate((el) => {
    const urls: Array<{href: string, title: string}> = [];
    for (const node of el.children) {
      const link = node.querySelector("a");
      if (link && link.href) {
        urls.push({href: (new URL(link.href)).href, title: link.innerText.trim()});
      }
    }
    return urls;
  });
  const re = config.excludedCategories ? new RegExp(config.excludedCategories, 'i') : null;
  const filteredLinks = re ? links.filter((item) => {
    return !re.test(item.title);
  }) : links;
  await enqueueLinks({
    urls: filteredLinks.map((item) => item.href),
    label: labels.categoryPage,
    userData: {
      parentLinks: filteredLinks.reduce((acc, item) => {
        acc[item.href] = item;
        return acc;
      }, {} as Record<string, any>)
    }
  });
});
