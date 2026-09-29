"""Visible nickname controls: home, seats, spectator, active game and another tab."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('GAME_URL', 'http://127.0.0.1:3181')
OUT = Path(os.environ.get('SCREENSHOT_DIR', '/tmp/landlord-screenshots'))
OUT.mkdir(parents=True, exist_ok=True)


def rename(page, name):
    page.get_by_role('button', name='修改昵称', exact=True).click()
    page.get_by_label('你的昵称', exact=True).fill(name)
    page.get_by_role('button', name='保存昵称', exact=True).click()
    expect(page.get_by_role('dialog', name='修改昵称', exact=True)).to_have_count(0)
    expect(page.locator('.profile-name')).to_have_text(name)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    contexts = [browser.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce') for _ in range(4)]
    pages = [context.new_page() for context in contexts]
    errors = []
    for page in pages:
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE)
        expect(page).to_have_title('Darwin斗地主')
        expect(page.get_by_role('button', name='开始练习', exact=True)).to_be_enabled()
    rename(pages[0], '青禾')
    other_tab = contexts[0].new_page()
    other_tab.goto(BASE)
    expect(other_tab.locator('.profile-name')).to_have_text('青禾')
    rename(pages[0], 'Darwin玩家')
    expect(other_tab.locator('.profile-name')).to_have_text('Darwin玩家')
    pages[0].reload()
    expect(pages[0].locator('.profile-name')).to_have_text('Darwin玩家')
    pages[0].get_by_role('button', name='创建房间', exact=True).click()
    expect(pages[0].locator('.invite-code b')).to_be_visible()
    code = pages[0].locator('.invite-code b').inner_text()
    for page in pages[1:]:
        page.get_by_role('textbox', name='六位房间码').fill(code)
        page.get_by_role('button', name='加入房间', exact=True).click()
        expect(page.locator('.room-title')).to_be_visible()
    rename(pages[0], '新的牌友')
    for page in pages[1:]:
        expect(page.locator('.seat-name').filter(has_text='新的牌友')).to_be_visible()
    expect(other_tab.locator('.profile-name')).to_have_text('新的牌友')
    rename(pages[3], '正在观战')
    pages[1].get_by_role('button', name='查看观众', exact=True).click()
    expect(pages[1].locator('.spectator-list')).to_contain_text('正在观战')
    pages[1].get_by_role('button', name='关闭', exact=True).click()
    pages[0].screenshot(path=str(OUT / 'nickname-pvp-desktop.png'), full_page=True)
    # A longest permitted name must remain editable on a narrow viewport.
    pages[0].set_viewport_size({'width': 320, 'height': 780})
    rename(pages[0], '春风又绿江南岸明月何时照我还呀呀')
    assert pages[0].evaluate('document.documentElement.scrollWidth <= innerWidth')
    seat_name = pages[0].locator('.seat-bottom .seat-player-name')
    expect(seat_name).to_be_visible()
    assert seat_name.bounding_box()['height'] < 25
    pages[0].screenshot(path=str(OUT / 'nickname-pvp-320.png'), full_page=True)
    pages[0].set_viewport_size({'width': 1280, 'height': 900})
    for page in pages[:3]:
        page.get_by_role('button', name='准备好了', exact=True).click()
        page.wait_for_timeout(120)
    expect(pages[0].locator('.hand [data-card]').first).to_be_visible()
    hand = pages[0].locator('.hand [data-card]').evaluate_all('(els) => els.map(e => e.dataset.card)')
    rename(pages[0], '对局中改名')
    expect(other_tab.locator('.profile-name')).to_have_text('对局中改名')
    for page in pages[1:3]:
        expect(page.locator('.seat-name').filter(has_text='对局中改名')).to_be_visible()
    assert pages[0].locator('.hand [data-card]').evaluate_all('(els) => els.map(e => e.dataset.card)') == hand
    # Nickname dialog supports cancel without a write, and empty input cannot save.
    pages[0].get_by_role('button', name='修改昵称', exact=True).click()
    pages[0].get_by_label('你的昵称', exact=True).fill('')
    expect(pages[0].get_by_role('button', name='保存昵称', exact=True)).to_be_disabled()
    pages[0].get_by_role('button', name='取消', exact=True).click()
    expect(pages[0].locator('.profile-name')).to_have_text('对局中改名')
    assert not errors, errors
    print('PASS title, home/room renaming, same-account tabs, seated/spectator sync, reload, 320px and unchanged active hand', flush=True)
    browser.close()
