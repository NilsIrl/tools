import * as Vue from 'https://unpkg.com/vue@3.2.11/dist/vue.esm-browser.prod.js'

const HousepartyExport = {
  data() {
    return {
      username: "",
      password: "",
      message: "",
      data: {
        notes: [],
        users: [],
      },
      selected_chat: "",
    }
  },

  computed: {
    chats() {
      return this.data.notes.reduce((previous, current) => {
        const chat_id = current.senderId === this.data.userId ? current.recipientId : current.senderId;
        if (!(chat_id in previous)) {
          previous[chat_id] = [];
        }
        previous[chat_id].push(current);
        return previous;
      }, {});
    },

    users_sorted_by_chat_count() {
      return this.data.users.sort((user1, user2) => this.chatCount(user1.id) < this.chatCount(user2.id));
    },
  },

  methods: {
    async login() {
      fetch("https://api2.thehousepartyapp.com/me/tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: this.username,
          password: this.password,
        })
      })
        .then(response => response.json())
        .then(async data => {
          if ("type" in data) {
            switch (data.type) {
              case "WrongPasswordException":
                this.message = "Wrong password entered";
                break;
              case "UserNotFoundException":
                this.message = "User doesn't exist";
                break;
              default:
                this.message = `Unhandled message ${data.type}: ${data.message}`;
                break;
            }
          } else {
            this.message = "Authentication successful";

            data = {...data, ...await fetch("https://api2.thehousepartyapp.com/me/relationships", {headers: {
              "Authorization": `Bearer ${data.tokenId}`,
            }}).then(response => response.json()), notes: []};
            this.message = "Downloaded relationships";

            let last = 0;
            do {
              const notes = await fetch(`https://api2.thehousepartyapp.com/me/notes/since/${last}`, {
                headers: {
                  "Authorization": `Bearer ${data.tokenId}`,
                }
              })
                .then(response => response.json());
              data.notes = data.notes.concat(notes.notes);
              this.message = `Downloaded ${data.notes.length} notes.`;
              last = new Date(notes.notes[notes.notes.length - 1].sentAt).getTime() + 1;
              if (notes.notes.length != 1000) {
                break;
              }
            } while (true);
            this.data = data;
            this.message = "Download complete";
          }
        })
    },

    upload() {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.data = JSON.parse(e.target.result);
      };
      reader.readAsText(document.getElementById("upload").files[0]);
    },

    download() {
      const download_file = document.getElementById("download_file");
      const url = window.URL.createObjectURL(new Blob([JSON.stringify(this.data)], {type: "application/json"}));
      download_file.href = url;
      download_file.click();
      window.URL.revokeObjectURL(url);
    },

    userInfo(id) {
      const user = this.data.users.find(user => user.id === id);
      if (user === undefined) {
        fetch(`https://api2.thehousepartyapp.com/me/relationships/${id}`, {
          headers: {
            "Authorization": `Bearer ${this.data.tokenId}`
          }
        })
          .then(response => response.json())
          .then(user => this.data.users.push(user));
        //return this.data.users[this.data.users.length - 1];
      } else {
        return user;
      }
    },

    chatCount(id) {
      return id in this.chats ? this.chats[id].length : 0;
    },

    fromMe(note) {
      return note.senderId === this.data.userId;
    }

  }
};

const app = Vue.createApp(HousepartyExport).mount('#app');
