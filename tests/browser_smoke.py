"""Real browser acceptance. Run against a local dev/production server with Playwright installed."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:5187')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots'))
OUT.mkdir(parents=True, exist_ok=True)

def screenshot(page, name):
    page.screenshot(path=str(OUT / (name + '.png')), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'horizontal overflow: {name}'
    print('PASS screenshot + overflow:', name, flush=True)

def click_visible(page, name):
    target = page.get_by_role('button', name=name, exact=True)
    if target.count() and target.first.is_visible() and target.first.is_enabled():
        target.first.click()
        return True
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':1440,'height':1000}, reduced_motion='reduce')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    expect(page.get_by_role('button', name='开始练习', exact=True)).to_be_enabled(timeout=15000)
    screenshot(page, 'home-light-desktop')
    page.get_by_role('button', name='切换深色主题').click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    screenshot(page, 'home-dark-desktop')
    page.get_by_role('button', name='癞子玩法', exact=True).click()
    expect(page.get_by_role('button', name='癞子玩法', exact=True)).to_have_attribute('aria-pressed','true')
    page.get_by_role('button', name='创建房间', exact=True).click()
    expect(page.get_by_text('留个位置，等你来')).to_be_visible()
    screenshot(page, 'room-waiting-dark')
    page.get_by_role('button', name='离开牌桌', exact=True).click()
    page.get_by_role('button', name='离开', exact=True).click()
    expect(page.get_by_role('button', name='开始练习',exact=True)).to_be_visible()
    page.set_viewport_size({'width':390,'height':844})
    screenshot(page, 'home-dark-390')
    page.get_by_role('button', name='切换浅色主题').click()
    page.get_by_role('button', name='开始练习',exact=True).click()
    expect(page.locator('.hand')).to_be_visible()
    screenshot(page, 'game-light-390')
    page.set_viewport_size({'width':320,'height':780})
    screenshot(page, 'game-light-320')
    first=page.locator('.hand [data-card]').first
    first.click(position={'x':5,'y':7})
    expect(first).to_have_attribute('aria-pressed','true')
    page.get_by_role('button', name='取消选牌').click()
    expect(first).to_have_attribute('aria-pressed','false')
    page.set_viewport_size({'width':844,'height':390})
    screenshot(page, 'game-light-landscape')
    page.set_viewport_size({'width':1440,'height':1000})
    page.get_by_role('button',name='切换深色主题').click()
    screenshot(page, 'game-dark-desktop')
    # One full real PVE game through the same actions available to a player.
    for tick in range(1300):
        if page.get_by_role('dialog',name='这一局，落定').count():
            break
        acted=False
        for name in ['叫地主','抢地主 ×2','不加倍']:
            if click_visible(page,name):
                acted=True
                break
        hint=page.get_by_role('button',name='提示',exact=True)
        if not acted and hint.count() and hint.is_enabled():
            hint.click()
            page.wait_for_timeout(100)
            if not click_visible(page,'出牌'):
                click_visible(page,'不出')
            else:
                if page.get_by_role('dialog',name='选择这手牌的解释').count():
                    page.locator('.interpretation').first.click()
        if tick % 100 == 0:
            print('PVE progress tick',tick,flush=True)
        page.wait_for_timeout(160)
    expect(page.get_by_role('dialog',name='这一局，落定')).to_be_visible(timeout=5000)
    screenshot(page,'pve-settlement')
    page.get_by_role('button',name='逐手复盘',exact=True).click()
    expect(page.get_by_role('dialog',name='逐手复盘')).to_be_visible()
    page.get_by_role('button',name='下一步').click()
    screenshot(page,'pve-replay')
    page.get_by_role('button',name='关闭',exact=True).click()
    assert not errors, errors
    print('PASS full PVE, replay, theme, narrow hand selection; no JS errors', flush=True)
    browser.close()
