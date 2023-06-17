"""LoginScreen"""

from kivymd.uix.screen import MDScreen


class LoginScreen(MDScreen):
    """LoginScreen"""

    def login(self):
        """login"""
        print(self.ids.phone_number.text)
        print("Let's login")
        self.manager.current = "home"
