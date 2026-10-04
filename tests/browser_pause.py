"""Real PVP/PVE turn pause; isolated users, spectator, reload, and touch layouts."""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:3185')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots'))
OUT.mkdir(parents=True, exist_ok=True)

def click(page, name):
    button = page.get_by_role('button', name=name, exact=True)
    if button.count() and button.is_visible() and button.is_enabled():
        button.click()
        return True
    return False

def start_playing(players, owner):
    for _ in range(150):
        if owner.get_by_role('button', name='暂停对局', exact=True).count():
            return
        for page in players:
            if click(page, '不加倍'):
                continue
            choices = ['叫地主', '抢地主 ×2'] if page == owner else ['不叫', '不抢']
            for name in choices:
                if click(page, name): break
        owner.wait_for_timeout(150)
    raise AssertionError('did not reach a human playing turn')

def hand(page):
    return page.locator('.hand [data-card]').evaluate_all('(els)=>els.map(e=>e.dataset.card)')

def room_layout(page, filename, has_button=True):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), filename
    toolbar = page.locator('.room-toolbar')
    bounds = [item.bounding_box() for item in toolbar.locator(':scope > *').all()]
    assert all(bounds[i]['x'] + bounds[i]['width'] <= bounds[i+1]['x'] + 1 for i in range(len(bounds)-1)), bounds
    assert page.locator('.action-zone .pause-button').count() == 0
    assert page.locator('.room-tools .pause-button').count() == int(has_button)
    banner = page.locator('.pause-banner').bounding_box()
    for item in page.locator('.table-top-info, .wild-indicator').all():
        hud = item.bounding_box()
        assert hud['y'] + hud['height'] <= banner['y'], (hud, banner)
    page.screenshot(path=str(OUT / filename), full_page=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    contexts = [browser.new_context(viewport={'width':1280,'height':900}, has_touch=True, reduced_motion='reduce') for _ in range(4)]
    pages = [context.new_page() for context in contexts]
    errors = []
    for index, page in enumerate(pages):
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE)
        expect(page.get_by_role('button', name='开始练习', exact=True)).to_be_enabled()
        if index == 0:
            page.get_by_role('button', name='设置', exact=True).click()
            page.get_by_label('你的昵称', exact=True).fill('一二三四五六七八九十一二三四五六')
            page.get_by_role('button', name='保存昵称', exact=True).click()
            expect(page.get_by_text('昵称已保存', exact=True)).to_be_visible()
            page.get_by_role('button', name='关闭', exact=True).click()
            page.locator('.toast button').click()
    owner = pages[0]
    owner.get_by_role('button', name='天地癞子', exact=True).click()
    owner.get_by_role('button', name='创建房间', exact=True).click()
    expect(owner.locator('.invite-code b')).to_be_visible()
    code = owner.locator('.invite-code b').inner_text()
    for page in pages[1:]:
        page.get_by_role('textbox', name='六位房间码').fill(code)
        page.get_by_role('button', name='加入房间', exact=True).click()
        expect(page.locator('.room-title')).to_be_visible()
    for page in pages[:3]:
        page.get_by_role('button', name='准备好了', exact=True).click()
    start_playing(pages[:3], owner)
    for page in pages[1:]:
        expect(page.get_by_role('button', name='暂停对局', exact=True)).to_have_count(0)
    # Spend some of the turn; preserve selection and never grant a fresh 30 seconds.
    owner.wait_for_timeout(1300)
    selected = owner.locator('.hand [data-card]').first
    selected.click(position={'x':5,'y':7})
    original_hand = hand(owner)
    before = int(re.search(r'\d+', owner.locator('.action-timer').inner_text()).group())
    owner.get_by_role('button', name='暂停对局', exact=True).click()
    for page in pages:
        expect(page.get_by_role('status', name='对局已暂停', exact=True)).to_be_visible()
        expect(page.locator('.pause-time')).to_have_text(owner.locator('.pause-time').inner_text())
    for page in pages[1:3]:
        expect(page.get_by_role('button', name='出牌', exact=True)).to_be_disabled()
        expect(page.get_by_role('button', name='继续对局', exact=True)).to_have_count(0)
    expect(owner.get_by_role('button', name='提示', exact=True)).to_be_disabled()
    expect(owner.get_by_role('button', name='出牌', exact=True)).to_be_disabled()
    expect(selected).to_have_attribute('aria-pressed', 'true')
    frozen = owner.locator('.pause-time').inner_text()
    seconds = int(re.search(r'\d+', frozen).group())
    assert 0 < seconds <= before < 30
    owner.wait_for_timeout(2200)
    expect(owner.locator('.pause-time')).to_have_text(frozen)
    expect(owner.locator('.action-timer')).to_have_text(f'{seconds}s')
    assert hand(owner) == original_hand
    assert pages[3].locator('.hand [data-card]').count() == 0
    for width, height in [(1280,900),(390,844),(320,780),(844,390)]:
        owner.set_viewport_size({'width':width,'height':height})
        for theme in ['light','dark']:
            if owner.locator('html').get_attribute('data-theme') != theme:
                owner.get_by_role('button', name='切换深色主题' if theme=='dark' else '切换浅色主题', exact=True).click()
            room_layout(owner, f'pause-pvp-{theme}-{width}.png')
    for width, height in [(320,780),(844,390)]:
        pages[1].set_viewport_size({'width':width,'height':height})
        room_layout(pages[1], f'pause-other-{width}.png', has_button=False)
    # Resume with touch, retaining both selected cards and the remaining deadline.
    owner.get_by_role('button', name='继续对局', exact=True).tap()
    expect(owner.get_by_role('status', name='对局已暂停', exact=True)).to_have_count(0)
    expect(owner.get_by_role('button', name='出牌', exact=True)).to_be_enabled()
    expect(selected).to_have_attribute('aria-pressed', 'true')
    resumed = int(re.search(r'\d+', owner.locator('.action-timer').inner_text()).group())
    assert resumed <= seconds
    owner.get_by_role('button', name='暂停对局', exact=True).tap()
    expect(owner.locator('.pause-time')).to_be_visible()
    frozen = owner.locator('.pause-time').inner_text()
    owner.reload()
    expect(owner.get_by_role('button', name='继续对局', exact=True)).to_be_enabled()
    expect(owner.locator('.pause-time')).to_have_text(frozen)
    assert hand(owner) == original_hand
    expect(owner.get_by_role('button', name='出牌', exact=True)).to_be_disabled()
    # A second tab of the same account also sees the table-wide pause.
    mirror = contexts[0].new_page()
    mirror.goto(BASE)
    expect(mirror.get_by_role('button', name='继续对局', exact=True)).to_be_enabled()
    expect(mirror.locator('.pause-time')).to_have_text(frozen)
    mirror.close()
    owner.get_by_role('button', name='继续对局', exact=True).click()
    for page in pages:
        expect(page.get_by_role('status', name='对局已暂停', exact=True)).to_have_count(0)
    owner.locator('.hand [data-card]').first.click(position={'x':5,'y':7})
    owner.get_by_role('button', name='出牌', exact=True).click()
    if owner.get_by_role('dialog', name='选择这手牌的解释').count():
        owner.locator('.interpretation').first.click()
    expect(owner.locator('.hand [data-card]')).to_have_count(len(original_hand)-1)
    print('PASS PVP: four synchronized views, spectator permission, exact frozen countdown, selection, reload, same-account tab, resume/play, toolbar layout', flush=True)
    for context in contexts: context.close()

    context = browser.new_context(viewport={'width':390,'height':844}, has_touch=True, reduced_motion='reduce')
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    expect(page.get_by_role('button', name='开始练习', exact=True)).to_be_enabled()
    page.get_by_role('button', name='开始练习', exact=True).click()
    start_playing([page], page)
    before_hand = hand(page)
    page.get_by_role('button', name='暂停对局', exact=True).tap()
    expect(page.locator('.pause-time')).to_be_visible()
    frozen = page.locator('.pause-time').inner_text()
    page.wait_for_timeout(2200)
    expect(page.locator('.pause-time')).to_have_text(frozen)
    assert hand(page) == before_hand
    room_layout(page, 'pause-pve-390.png')
    page.get_by_role('button', name='继续对局', exact=True).tap()
    hint = page.get_by_role('button', name='提示', exact=True)
    expect(hint).to_be_enabled()
    hint.click()
    expect(hint).to_be_enabled(timeout=10000)
    if not click(page, '出牌'): click(page, '不出')
    elif page.get_by_role('dialog', name='选择这手牌的解释').count():
        page.locator('.interpretation').first.click()
    expect(page.get_by_role('button', name='暂停对局', exact=True)).to_have_count(0)
    assert not errors, errors
    print('PASS PVE: human-turn pause, frozen state and normal play after resume; no JS errors', flush=True)
    browser.close()
