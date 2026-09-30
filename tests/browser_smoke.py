"""Real browser acceptance. Run against a local dev/production server with Playwright installed."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:5187')
MODE_LABEL = os.environ.get('GAME_MODE_LABEL', '癞子玩法')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots'))
OUT.mkdir(parents=True, exist_ok=True)

def screenshot(page, name):
    page.screenshot(path=str(OUT / (name + '.png')), full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'horizontal overflow: {name}'
    brand = page.locator('.brand').bounding_box()
    tools = page.locator('.header-tools').bounding_box()
    assert brand['x'] + brand['width'] <= tools['x'], f'header overlap: {name}'
    assert page.locator('.wallet').bounding_box()['height'] < 38, f'wrapped balance: {name}'
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
    expect(page.get_by_role('group', name='底注', exact=True).get_by_role('button', name='10', exact=True)).to_have_attribute('aria-pressed','true')
    screenshot(page, 'home-light-desktop')
    page.get_by_role('button', name='切换深色主题').click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    screenshot(page, 'home-dark-desktop')
    page.get_by_role('button', name=MODE_LABEL, exact=True).click()
    expect(page.get_by_role('button', name=MODE_LABEL, exact=True)).to_have_attribute('aria-pressed','true')
    page.reload()
    expect(page.get_by_role('button', name=MODE_LABEL, exact=True)).to_have_attribute('aria-pressed','true')
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    page.get_by_role('button', name='创建房间', exact=True).click()
    expect(page.get_by_text('留个位置，等你来')).to_be_visible()
    expect(page.get_by_role('button', name='重置 Tokens', exact=True)).to_have_count(0)
    screenshot(page, 'room-waiting-dark')
    page.get_by_role('button', name='离开牌桌', exact=True).click()
    page.get_by_role('button', name='离开', exact=True).click()
    expect(page.get_by_role('button', name='开始练习',exact=True)).to_be_visible()
    page.set_viewport_size({'width':390,'height':844})
    screenshot(page, 'home-dark-390')
    page.get_by_role('button', name='切换浅色主题').click()
    page.get_by_role('group', name='底注', exact=True).get_by_role('button', name='20', exact=True).click()
    page.get_by_role('button', name='开始练习',exact=True).click()
    expect(page.locator('.hand')).to_be_visible()
    if MODE_LABEL == '天地癞子':
        expect(page.get_by_label('天地癞子点数')).to_contain_text('地癞子 待定')
        assert page.locator('.hand .is-wild').count() == page.locator('.hand [aria-label*="天癞子"]').count()
    expect(page.locator('.stake-value')).to_have_text('底注 20 Tokens')
    expect(page.get_by_role('button', name='重置 Tokens', exact=True)).to_have_count(0)
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
            expect(hint).to_be_enabled(timeout=10000)
            if not click_visible(page,'出牌'):
                click_visible(page,'不出')
            else:
                if page.get_by_role('dialog',name='选择这手牌的解释').count():
                    page.locator('.interpretation').first.click()
        if tick % 100 == 0:
            print('PVE progress tick',tick,flush=True)
        page.wait_for_timeout(160)
    expect(page.get_by_role('dialog',name='这一局，落定')).to_be_visible(timeout=5000)
    expect(page.locator('.result-head')).to_contain_text('底注 20 Tokens')
    screenshot(page,'pve-settlement')
    page.get_by_role('button',name='逐手复盘',exact=True).click()
    expect(page.get_by_role('dialog',name='逐手复盘')).to_be_visible()
    if MODE_LABEL == '天地癞子':
        expect(page.locator('.replay-explanation')).to_contain_text('天癞子')
        expect(page.locator('.replay-explanation')).to_contain_text('地癞子')
        assert page.locator('.replay-hands [aria-label*="天癞子"]').count() in [1,2,3,4]
        # Before collecting bottom cards, a few earth wildcards may still be in the bottom.
        assert page.locator('.replay-hands [aria-label*="地癞子"]').count() in [1,2,3,4]
    expect(page.locator('.replay-explanation')).to_contain_text('底注 20 Tokens')
    page.get_by_role('button',name='下一步').click()
    screenshot(page,'pve-replay')
    page.get_by_role('button',name='关闭',exact=True).click()
    page.get_by_role('button',name='离开牌桌',exact=True).click()
    page.get_by_role('button',name='离开',exact=True).click()
    expect(page.get_by_role('button',name='重置 Tokens',exact=True)).to_be_enabled()
    expect(page.locator('.wallet')).not_to_have_attribute('title','100000 Tokens')
    original_balance = page.locator('.wallet').get_attribute('title')
    sibling = context.new_page()
    sibling.on('pageerror', lambda e: errors.append(str(e)))
    sibling.goto(BASE)
    expect(sibling.locator('.wallet')).to_have_attribute('title',original_balance)
    reset_requests = []
    page.on('request', lambda req: reset_requests.append(req) if req.url.endswith('/api/me/reset-tokens') else None)

    page.set_viewport_size({'width':320,'height':780})
    reset = page.get_by_role('button',name='重置 Tokens',exact=True)
    expect(reset.locator('svg')).to_have_count(1)
    assert not reset.inner_text().strip()
    reset.click()
    expect(page.get_by_role('dialog',name='臭牌篓子来重置Token啦？',exact=True)).to_be_visible()
    screenshot(page,'token-reset-first-320')
    page.get_by_role('button',name='取消',exact=True).click()
    expect(page.locator('.wallet')).to_have_attribute('title',original_balance)
    reset.click()
    page.get_by_role('button',name='确认',exact=True).click()
    expect(page.get_by_role('dialog',name='这么说你承认你是臭牌篓子喽？',exact=True)).to_be_visible()
    screenshot(page,'token-reset-second-320')
    page.get_by_role('button',name='我不是臭牌篓子！',exact=True).click()
    expect(page.locator('.wallet')).to_have_attribute('title',original_balance)
    assert not reset_requests
    reset.click()
    page.get_by_role('button',name='确认',exact=True).click()
    page.get_by_role('button',name='我就是臭牌篓子，给我重置吧',exact=True).click()
    expect(page.locator('.wallet')).to_have_attribute('title','100000 Tokens')
    expect(sibling.locator('.wallet')).to_have_attribute('title','100000 Tokens')
    expect(page.get_by_role('dialog')).to_have_count(0)
    assert len(reset_requests) == 1
    page.reload()
    expect(reset).to_be_enabled()
    expect(page.locator('.wallet')).to_have_attribute('title','100000 Tokens')
    screenshot(page,'token-reset-home-320')
    # A room entered in another tab must dismiss any stale reset confirmation.
    reset.click()
    page.get_by_role('button',name='确认',exact=True).click()
    sibling.get_by_role('button',name='创建房间',exact=True).click()
    expect(page.locator('.room-title')).to_be_visible()
    expect(page.get_by_role('dialog')).to_have_count(0)
    expect(reset).to_have_count(0)
    sibling.get_by_role('button',name='离开牌桌',exact=True).click()
    sibling.get_by_role('button',name='离开',exact=True).click()
    expect(reset).to_be_enabled()
    expect(page.get_by_role('dialog')).to_have_count(0)
    assert len(reset_requests) == 1
    sibling.close()
    assert not errors, errors
    print('PASS full PVE, replay, theme, narrow selection, homepage-only SVG reset, both cancellations, exact 100K, other tab sync and reload; no JS errors', flush=True)
    browser.close()
