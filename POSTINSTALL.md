<!-- 
This file provides your users an overview of how to use your extension after they've installed it. All content is optional, but this is the recommended format. Your users will see the contents of this file in the Firebase console after they install the extension.

Include instructions for using the extension and any important functional details. Also include **detailed descriptions** for any additional post-installation setup required by the user.

Reference values for the extension instance using the ${param:PARAMETER_NAME} or ${function:VARIABLE_NAME} syntax.
Learn more in the docs: https://firebase.google.com/docs/extensions/publishers/user-documentation#reference-in-postinstall

Learn more about writing a POSTINSTALL.md file in the docs:
https://firebase.google.com/docs/extensions/publishers/user-documentation#writing-postinstall
-->

#### Set your Cloud Firestore rules

Set up your security roles so that only authenticated users can access support messages, and that each user can only access their own messages. 

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /${param:MESSAGES_PATH}/{id} {
      allow read, create: if request.auth != null && request.auth.uid == userId;
      allow update, delete: if false;
    }
  }
}
```

#### Set your Cloud Firestore indexes

Create this `fieldOverride` within `firestore.indexes.json`:
```
{
  "indexes": [...],
  "fieldOverrides": [
    {
      "collectionGroup": "support",
      "fieldPath": "slackThreadTs",
      "ttl": false,
      "indexes": [
        {
          "order": "ASCENDING",
          "queryScope": "COLLECTION"
        },
        {
          "order": "DESCENDING",
          "queryScope": "COLLECTION"
        },
        {
          "arrayConfig": "CONTAINS",
          "queryScope": "COLLECTION"
        },
        {
          "order": "ASCENDING",
          "queryScope": "COLLECTION_GROUP"
        }
      ]
    }
  ]
}
```

#### Configure the Firebase Integration in the Slack App

Log in to your [Slack Apps](https://api.slack.com/apps/), select your app in the dropdown, then go to Features -> Event Subscriptions. After enabling the events, in the field **Request URL**, enter the following value: 
```
${function:handler.url}
```

<!-- We recommend keeping the following section to explain how to monitor extensions with Firebase -->
#### Monitoring

As a best practice, you can [monitor the activity](https://firebase.google.com/docs/extensions/manage-installed-extensions#monitor) of your installed extension, including checks on its health, usage, and logs.
