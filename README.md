# Studio Manager

複数スタジオ対応の予約・売上管理ツール(Metaland Tokyo / Studio VirtuaReal)。

本番URL: https://studio.metalandtokyo.xyz

## 機能

- ダッシュボード(月別の売上・入金状況)
- 予約管理
- 銀行明細ペーストによる入金消込
- 顧客名簿
- クーポン管理
- メール文章作成(受信メール本文を貼り付け → テンプレートから確定メール文章を作成。送信は各自のメールソフトから)
- スタジオ別の料金設定(プラン・オプション・延長料金)
- スタジオ管理
- メンバー管理(招待制。アドミン/マネージャー/スタッフの3ロール)

## 構成

- `index.html` — アプリ本体(単一ページ。ビルド不要)
- Firebase プロジェクト: `studiomanager-5eb1d`
  - Hosting: `studiomanager-5eb1d.web.app`(独自ドメイン `studio.metalandtokyo.xyz` を CNAME で割り当て)
  - Authentication: メールアドレス+パスワード
  - Firestore: データ保存。ロールごとの権限は `firestore.rules` で制御

## Google連携(スタジオごと)

スタジオ管理の「編集」で、予約スプレッドシートのURLとGoogleカレンダーのカレンダーIDを登録できます。登録したスタジオでは「取り込み」から予約をアプリに読み込めます。

- スプレッドシート: 列の対応づけ(日付・時間・お客様名など)はスタジオごとに保存され、次回から自動で使われます
- カレンダー: 時間指定の予定を、タイトル=お客様名・説明=備考として取り込みます
- 同じ行や予定を二重に取り込まないよう、取り込み元を `importKey` で記録しています。同じスタジオ・同じ日時に既存の予約がある行は、初期状態では選択されません
- 読み込みは閲覧のみの権限(`spreadsheets.readonly` / `calendar.readonly`)で、接続したユーザーのGoogleアカウントの権限で行います。アクセストークンはブラウザのメモリ上にだけ保持します

初期設定(Google Cloud Console、プロジェクト `studiomanager-5eb1d`):

1. 「Google Sheets API」と「Google Calendar API」を有効にする
2. OAuth同意画面を設定する
3. 「認証情報」→「OAuthクライアントID」(ウェブアプリケーション)を作成し、承認済みのJavaScript生成元に `https://studio.metalandtokyo.xyz` などを追加する
4. 発行されたクライアントIDを `index.html` の `GOOGLE_OAUTH_CLIENT_ID` に設定する

## アカウント

- 新規登録画面はなく、アドミンが「メンバー管理」から招待します。招待された人にはパスワード設定メールが届きます。
- 初期セットアップ時のみ、最初にログインしたユーザーが自動的にアドミンになります(Firestore の `system/bootstrap` が作成された時点でこの経路は閉じます。設定済み)。

## デプロイ

```bash
firebase deploy
```

Hosting と Firestore ルールがまとめて反映されます。
