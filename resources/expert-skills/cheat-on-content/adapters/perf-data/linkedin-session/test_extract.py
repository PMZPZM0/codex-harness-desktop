"""extract.py 的单元测试。用合成样本（不提交真实指标）。

跑：python test_extract.py
"""
from extract import _to_int, parse_post_meta, parse_post_summary

# 合成样本：复刻真实 /analytics/post-summary/ 的 inner_text 版式（日文界面），数字是假的。
POST_SAMPLE_JP = """Heqing Huangさんが投稿しました • 4日
post body line one
post body line two with a stray number 123 inside
調査
9,999
インプレッション数
800
リーチしたメンバー
プロフィールアクティビティ
5
この投稿からのプロフィール閲覧ユーザー
2
この投稿で獲得したフォロワー
エンゲージメント
30
ソーシャルエンゲージメント
リアクション
20
コメント
6
再投稿
3
保存数
1
LinkedInでの送信数
0
上位統計データ
"""

# 英文界面（LinkedIn 随机切换）。
POST_SAMPLE_EN = """Heqing Huang posted this • 6d
post body text with stray number 999
Discovery
50,000
Impressions
30,000
Members reached
Profile activity
400
Profile viewers from this post
180
Followers gained from this post
Engagement
300
Social engagements
Reactions
100
Comments
25
Reposts
8
Saves
100
Sends on LinkedIn
67
Top demographics
"""


def test_to_int():
    assert _to_int("34,057") == 34057
    assert _to_int("152") == 152
    assert _to_int("1.2K") == 1200
    assert _to_int("3M") == 3_000_000
    assert _to_int("n/a") is None


def test_parse_post_summary_jp():
    m = parse_post_summary(POST_SAMPLE_JP)["metrics"]
    assert m["impressions"] == 9999, m
    assert m["reach"] == 800, m
    assert m["profile_views_from_post"] == 5, m
    assert m["followers_from_post"] == 2, m
    assert m["social_engagement"] == 30, m
    assert m["reactions"] == 20, m
    assert m["comments"] == 6, m
    assert m["reposts"] == 3, m
    assert m["saves"] == 1, m
    assert m["sends"] == 0, m


def test_parse_post_summary_en():
    m = parse_post_summary(POST_SAMPLE_EN)["metrics"]
    assert m["impressions"] == 50000, m
    assert m["reach"] == 30000, m
    assert m["profile_views_from_post"] == 400, m
    assert m["followers_from_post"] == 180, m
    assert m["social_engagement"] == 300, m
    assert m["reactions"] == 100, m
    assert m["comments"] == 25, m
    assert m["reposts"] == 8, m
    assert m["saves"] == 100, m
    assert m["sends"] == 67, m


def test_parse_post_summary_missing_is_none():
    assert parse_post_summary("no metrics here")["metrics"]["impressions"] is None


def test_parse_post_meta_jp():
    meta = parse_post_meta(POST_SAMPLE_JP)
    assert meta["author"] == "Heqing Huang", meta
    assert meta["age"] == "4日", meta
    assert "post body line one" in meta["text"], meta
    assert "post body line two" in meta["text"], meta
    # 正文不应吃进指标小标题 / 指标
    assert "調査" not in meta["text"], meta
    assert "インプレッション数" not in meta["text"], meta


def test_parse_post_meta_en():
    meta = parse_post_meta(POST_SAMPLE_EN)
    assert meta["author"] == "Heqing Huang", meta
    assert meta["age"] == "6d", meta
    assert "post body text" in meta["text"], meta
    assert "Discovery" not in meta["text"], meta


def test_parse_post_meta_missing():
    meta = parse_post_meta("no byline at all\njust text")
    assert meta == {"author": "", "age": "", "text": ""}, meta


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"✓ {fn.__name__}")
    print(f"\n{len(fns)} passed")
