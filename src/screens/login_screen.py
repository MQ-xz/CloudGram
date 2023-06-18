"""LoginScreen"""

from kivymd.uix.screen import MDScreen
from kivymd.uix.boxlayout import MDBoxLayout


class LoginScreen(MDScreen):
    """LoginScreen"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.phone_number = None
        self.otp = None

    def send_otp(self, phone_number):
        """login"""
        print("Let's login : LoginScreen")
        self.phone_number = phone_number.ids.phone_number.text
        print(self.phone_number)
        self.ids.login_screen_layout.remove_widget(phone_number)
        self.ids.login_screen_layout.add_widget(EnterOTP())

    def login(self, otp):
        """login"""
        print("Let's login : LoginScreen")
        self.otp = otp.ids.otp.text
        print(self.otp)
        self.manager.current = "home"


class EnterOTP(MDBoxLayout):
    """EnterOTP"""
