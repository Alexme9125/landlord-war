"""Four isolated browser contexts: complete PVP, watching, seat changes, refresh and forfeit."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('GAME_URL','http://127.0.0.1:5187')
OUT=Path('/tmp/landlord-screenshots')
OUT.mkdir(exist_ok=True)

def do_if_enabled(page,name):
    btn=page.get_by_role('button',name=name,exact=True)
    if btn.count() and btn.first.is_visible() and btn.first.is_enabled():
        btn.first.click()
        return True
    return False

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    contexts=[browser.new_context(viewport={'width':1280,'height':900},reduced_motion='reduce') for _ in range(4)]
    pages=[ctx.new_page() for ctx in contexts]
    errors=[]
    names=['青禾','听雨','远川','观众']
    for i,page in enumerate(pages):
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE)
        expect(page.get_by_role('button',name='开始练习',exact=True)).to_be_enabled()
        page.get_by_role('button',name='设置',exact=True).click()
        page.get_by_label('你的昵称',exact=True).fill(names[i])
        page.get_by_role('button',name='保存昵称',exact=True).click()
        expect(page.get_by_text('昵称已保存',exact=True)).to_be_visible()
        page.get_by_role('button',name='关闭',exact=True).click()
    pages[0].get_by_role('button',name='创建房间',exact=True).click()
    expect(pages[0].locator('.invite-code b')).to_be_visible()
    code=pages[0].locator('.invite-code b').inner_text()
    for page in pages[1:]:
        page.get_by_role('textbox',name='六位房间码').fill(code)
        page.get_by_role('button',name='加入房间',exact=True).click()
        expect(page.locator('.room-title')).to_be_visible()
    expect(pages[3].get_by_text('你正在观战，有空座时可点击坐下',exact=True)).to_be_visible()
    pages[1].get_by_role('button',name='站起观战',exact=True).click()
    expect(pages[3].get_by_role('button',name='空座 · 坐下',exact=True)).to_be_enabled()
    pages[3].get_by_role('button',name='空座 · 坐下',exact=True).click()
    expect(pages[3].get_by_role('button',name='准备好了',exact=True)).to_be_visible()
    expect(pages[1].get_by_text('你正在观战，有空座时可点击坐下',exact=True)).to_be_visible()
    players=[pages[0],pages[3],pages[2]]
    watcher=pages[1]
    for page in players:
        page.get_by_role('button',name='准备好了',exact=True).click()
        page.wait_for_timeout(100)
    expect(players[0].locator('.hand')).to_be_visible()
    assert watcher.locator('.hand [data-card]').count()==0
    watcher.screenshot(path=str(OUT/'pvp-spectator.png'),full_page=True)
    # Reload is a real disconnect/reconnect. It must restore the same hand and room.
    before=players[0].locator('.hand [data-card]').evaluate_all('(els)=>els.map(e=>e.dataset.card)')
    players[0].reload()
    expect(players[0].locator('.hand [data-card]')).to_have_count(len(before))
    after=players[0].locator('.hand [data-card]').evaluate_all('(els)=>els.map(e=>e.dataset.card)')
    assert before==after
    print('PASS 4 browsers, full room spectator, stand/sit, refresh preserves hand',flush=True)
    for tick in range(900):
        if players[0].get_by_role('dialog',name='这一局，落定').count():break
        for page in players:
            acted=False
            for name in ['叫地主','抢地主 ×2','不加倍']:
                if do_if_enabled(page,name):acted=True;break
            if not acted and do_if_enabled(page,'提示'):
                page.wait_for_timeout(75)
                if not do_if_enabled(page,'出牌'):
                    do_if_enabled(page,'不出')
                elif page.get_by_role('dialog',name='选择这手牌的解释').count():
                    page.locator('.interpretation').first.click()
        if tick%50==0:print('PVP progress',tick,flush=True)
        pages[0].wait_for_timeout(100)
    for page in pages:
        expect(page.get_by_role('dialog',name='这一局，落定')).to_be_visible()
    snapshots=[page.locator('.result-lines').inner_text().replace('你','') for page in pages]
    assert all(text==snapshots[0] for text in snapshots), snapshots
    watcher.get_by_role('button',name='逐手复盘',exact=True).click()
    expect(watcher.locator('.replay-hands')).to_be_visible()
    players[0].screenshot(path=str(OUT/'pvp-settlement.png'),full_page=True)
    print('PASS full PVP, all four identical settlement, spectator full replay after game',flush=True)
    for page in pages:page.get_by_role('button',name='关闭',exact=True).click()
    for page in players:
        page.get_by_role('button',name='准备好了',exact=True).click()
        page.wait_for_timeout(100)
    # Determine landlord, then one player voluntarily leaves; round must end for everyone.
    for tick in range(50):
        if any(page.get_by_role('button',name='不加倍',exact=True).count() for page in players):break
        for page in players:
            if not do_if_enabled(page,'叫地主'):do_if_enabled(page,'不抢')
        players[0].wait_for_timeout(100)
    assert any(page.get_by_role('button',name='不加倍',exact=True).count() for page in players)
    players[0].get_by_role('button',name='离开牌桌',exact=True).click()
    players[0].get_by_role('button',name='离开',exact=True).click()
    expect(players[0].get_by_role('button',name='开始练习',exact=True)).to_be_visible()
    expect(players[1].get_by_role('dialog',name='这一局，落定')).to_be_visible()
    expect(players[1].get_by_text('青禾 离开对局',exact=False)).to_be_visible()
    assert not errors,errors
    print('PASS voluntary leave ends round; no JS errors',flush=True)
    browser.close()
