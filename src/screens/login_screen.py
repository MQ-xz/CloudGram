"""LoginScreen"""

from functools import partial
from kivymd.uix.screen import MDScreen
from kivymd.uix.boxlayout import MDBoxLayout
from kivy.clock import Clock

from src.utils.telegram import telegram


class LoginScreen(MDScreen):
    """LoginScreen"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.phone_number = ""
        self.otp = ""
        self.hash_code = ""

    def otp_request(
        self, phone_number, *args
    ):  # pylint: disable=unused-argument
        """send otp request to telegram"""

        print("hehe")
        # sleep(2)
        print(self.phone_number, "otp_request")
        telegram.connect()
        send_code = telegram.send_code(self.phone_number)
        print(send_code, "sendcode")
        self.hash_code = send_code.phone_code_hash
        # add error
        if self.phone_number == "+918129367724":
            self.ids.login_screen_layout.remove_widget(phone_number)
            self.ids.login_screen_layout.add_widget(EnterOTP())
        phone_number.theme_text_color = "Error"
        phone_number.ids.send_otp_button.disabled = False
        phone_number.ids.send_otp_button.text = "Resending"

    def send_otp(self, phone_number):
        """login"""
        print("Let's login : LoginScreen")

        self.phone_number = phone_number.ids.phone_number.text
        # set loading
        phone_number.ids.send_otp_button.disabled = True
        phone_number.ids.send_otp_button.text = "Sending"

        Clock.schedule_once(partial(self.otp_request, phone_number))

    def login(self, otp):
        """login"""
        print("Let's login : LoginScreen")
        self.otp = otp.ids.otp.text
        try:
            telegram.sign_in(self.phone_number, self.hash_code, self.otp)
            self.manager.current = "home"
        except Exception as error:
            print(error)


class EnterOTP(MDBoxLayout):
    """EnterOTP"""
