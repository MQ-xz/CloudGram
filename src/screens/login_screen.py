from kivymd.uix.screen import MDScreen


class LoginScreen(MDScreen):
    pass

    def login(self):
        print(self.ids.phone_number.text)
        print("Let's login")
        self.manager.current = "home"
