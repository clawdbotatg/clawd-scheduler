const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  await page.goto('https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F&dsh=S808415583%3A1781363835997106&emr=1&followup=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F&osid=1&passive=1209600&service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin&ifkv=AcDsRvxvOJcB0JzY3VTP9n8PZc4Lt2e6uOciS2ySF_kdz5JZ-lWkYng4IdVlqaglQjOV2oTchh-r');
  await page.locator('div').nth(2).click();
  await page.close();

  // ---------------------
  await context.close();
  await browser.close();
})();